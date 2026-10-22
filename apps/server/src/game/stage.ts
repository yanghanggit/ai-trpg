import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors, games, stages, worlds } from "../db/schema";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ChatMessage } from "../llm/types";
import { DEFAULT_NPC_MAX_ROUNDS, MEMORY_KINDS } from "./actions";
import { adjacentStageNames, findStage } from "./actors";
import { appendPublicMessage, bumpGameVersion } from "./apply/messages";
import { GameError } from "./errors";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { appendStageEvent } from "./observations";
import {
  buildActorInfoTool,
  buildStageLookTool,
  buildSubmitEnvironmentTool,
  describeActor,
  lookStage,
  parseEnvironment,
} from "./plan";
import { getGameState } from "./service";
import type { GameState, StagePlan, StageState, StageTurnResult } from "./types";

type StageActorRow = typeof actors.$inferSelect;

export type StageTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

/** 构造 stage 小 GM 本轮的当前场景观察；仲裁与探针共用。 */
export function buildStageObservation(state: GameState, stage: StageState): string {
  const moves = adjacentStageNames(state, stage.id);
  return [
    "# 当前场景",
    `## 场景\n${stage.name}\n${stage.profile}`,
    `## 当前环境\n${stage.environment}`,
    `## 同场景角色\n${
      stage.actors.length === 0
        ? "无"
        : stage.actors
            .map((actor) => `${actor.name}：${actor.appearance}${actor.death ? "（已死亡）" : ""}`)
            .join("\n")
    }`,
    `## 场景物品\n${
      stage.items.length === 0
        ? "无"
        : stage.items.map((item) => `${item.name}（${item.kind}）：${item.description}`).join("\n")
    }`,
    `## 可去场景\n${moves.length === 0 ? "无" : moves.join("、")}`,
    "# 本轮任务",
    "你是本场景的小 GM。根据当前环境、自己的记忆和场景内发生的事件，判断环境是否发生变化。",
    "当前环境与 ## 场景物品 是当前事实；初始叙事可能已经过时，只能作为背景参考。",
    "当前只能更新 environment：提交完整的新环境快照，而不是只描述变化。",
    "environment 必须是客观的当前快照：只写现在能直接观察到的状态，不写历史、因果、变化过程，也不写对过去的推断。",
    "## 场景物品 是 environment 中唯一允许出现的物品清单；仍在场景中的物品要保留描述，物品不在场景中时直接省略，不要写它曾经存在、消失、被拿走，或描述它留下的空位、印子、痕迹、碎屑等历史线索。",
    "记忆中的“拾取、使用、拿走某物”只说明它曾被处理过，不代表它现在仍在场景中；即使记忆提到它，只要 ## 场景物品 没有它，就不要把它写进 environment。",
    "不要为了让环境看起来连续而补写“原来”“曾经”“留下”“留着”“不见了”“消失”“被拿走”之类内容；记忆只用于判断当前状态，不把历史写进 environment。",
    "不要用“痕迹、渍痕、污渍、残留、碎屑、空位、印子、缺口”等词暗示物品曾经存在或发生过变化；只写当前可见的稳定状态。",
    "environment 不能包含角色名称、角色行动或角色状态；角色由场景状态单独承载。",
    "不要替角色行动，不要修改角色属性、物品、位置或其他场景。",
    "需要查看场景或同场景角色时，使用 look_stage / get_actor；最后调用 submit_environment。",
  ].join("\n\n");
}

function assertEnvironmentHasNoActorNames(
  environment: string,
  stageActors: readonly Pick<StageActorRow, "name">[],
): void {
  for (const actor of stageActors) {
    if (environment.includes(actor.name)) {
      throw new GameError("invalid_action", `environment 不能包含角色名: ${actor.name}`);
    }
  }
}

/**
 * 在事务中应用一次 stage 仲裁计划。
 *
 * 计划非法时写入 stage memory 并返回 false；数据库错误继续抛出。
 */
export async function applyStagePlan(
  db: Database,
  gameId: string,
  stageId: string,
  plan: StagePlan | null,
  newMessages: readonly ChatMessage[],
  loopSuccess: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1).for("update");
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    if (game.status !== "active") {
      throw new GameError("invalid_state", `游戏已结束，不能继续行动: ${game.status}`);
    }
    const [world] = await tx.select().from(worlds).where(eq(worlds.gameId, gameId)).limit(1);
    if (!world) {
      throw new GameError("invalid_state", `游戏缺少 world: ${gameId}`);
    }
    const [stage] = await tx
      .select()
      .from(stages)
      .where(and(eq(stages.id, stageId), eq(stages.worldId, world.id)))
      .limit(1);
    if (!stage) {
      throw new GameError("not_found", `stage 不存在: ${stageId}`);
    }
    const memory = await loadAgentMemory(tx, gameId, "stage", stage.id);
    if (!memory) {
      throw new GameError("invalid_state", `stage 缺少 memory: ${stage.id}`);
    }
    const stageActors = await tx.select().from(actors).where(eq(actors.stageId, stage.id));

    if (!plan) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 仲裁结果\n本轮没有提交有效环境更新，状态未改变。",
          metadata: { kind: MEMORY_KINDS.planFailed, loopSuccess },
        },
      ]);
      return false;
    }

    try {
      assertEnvironmentHasNoActorNames(plan.environment, stageActors);
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: `# 仲裁结果\n环境更新被拒绝：${error.message}`,
          metadata: { kind: MEMORY_KINDS.actionRejected },
        },
      ]);
      return false;
    }

    if (newMessages.length > 0) {
      await appendMemoryMessages(tx, memory.row.id, [...newMessages]);
    }

    const now = new Date();
    await tx.update(stages).set({ environment: plan.environment }).where(eq(stages.id, stage.id));
    await bumpGameVersion(tx, gameId, now);

    const content = `${stage.name}的环境发生了变化。\n${plan.environment}`;
    await appendPublicMessage(tx, gameId, null, {
      kind: "environment_change",
      stageId: stage.id,
      visibility: "stage",
      content,
    });
    await appendStageEvent(tx, gameId, stage.id, `# 场景事件\n${content}`, {
      eventKind: "environment_change",
    });

    return true;
  });
}

/**
 * 为单个 stage 跑一轮小 GM agent loop，应用 environment 更新并返回最新状态。
 *
 * stage 回合由调用方显式推动；不会自动随 actor 行动运行。
 */
export async function runStageTurn(
  db: Database,
  gameRef: string,
  stageRef: string,
  options: StageTurnOptions,
): Promise<StageTurnResult> {
  const state = await getGameState(db, gameRef);
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  const stage = findStage(state, stageRef);
  const memory = await loadAgentMemory(db, state.game.id, "stage", stage.id);
  if (!memory) {
    throw new GameError("invalid_state", `stage 缺少 memory: ${stage.name}`);
  }

  const lookTool = buildStageLookTool(stage.name);
  const actorInfoTool = buildActorInfoTool(stage.actors.map((actor) => actor.name));
  const submitTool = buildSubmitEnvironmentTool();
  let submitted: StagePlan | null = null;

  const loop = await agentLoop({
    name: stage.name,
    inputMessage: buildStageObservation(state, stage),
    messages: memory.messages,
    tools: [lookTool, actorInfoTool, submitTool],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return lookStage(state, stageName);
      },
      [actorInfoTool.function.name]: (args) => {
        const targetActorName =
          typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
        const target = stage.actors.find((actor) => actor.name === targetActorName);
        if (!target) {
          return `错误：当前场景内找不到角色 ${targetActorName}`;
        }
        return describeActor(target);
      },
      [submitTool.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "环境已提交");
        }
        submitted = { environment: parseEnvironment(args) };
        return "环境更新已提交";
      },
    },
    terminalTools: [submitTool],
    service: options.service,
    maxRounds: options.maxRounds ?? DEFAULT_NPC_MAX_ROUNDS,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
  });

  const newMessages = loop.messages.slice(loop.startIndex, loop.endIndex);
  const ok = await applyStagePlan(
    db,
    state.game.id,
    stage.id,
    submitted,
    newMessages,
    loop.success,
  );

  return {
    ok,
    plan: submitted,
    loopSuccess: loop.success,
    state: await getGameState(db, state.game.id),
  };
}
