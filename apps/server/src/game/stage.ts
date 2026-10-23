import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors, games, stages, worlds } from "../db/schema";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ChatMessage } from "../llm/types";
import { adjacentStageNames, findStage } from "./actors";
import { appendPublicMessage, bumpGameVersion } from "./apply/messages";
import {
  DEFAULT_NPC_MAX_ROUNDS,
  MAX_STAGE_NOTIFICATIONS_PER_TURN,
  MEMORY_KINDS,
} from "./constants";
import { GameError } from "./errors";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { appendStageEvent } from "./observations";
import {
  buildNotifyWorldTool,
  buildObserveActorTool,
  buildStageLookTool,
  buildSubmitEnvironmentTool,
  describeObservedActor,
  lookStage,
  parseEnvironment,
  parseWorldNotification,
} from "./plan";
import { getGameState } from "./service";
import { canNotifyWorld, canSubmitEnvironment } from "./stage-actions";
import type { GameState, StageActionKind, StagePlan, StageState, StageTurnResult } from "./types";
import { appendWorldNotification } from "./world-events";

type StageActorRow = typeof actors.$inferSelect;

export type StageTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

/** 构造 stage 小 GM 本轮的当前场景观察；仲裁与探针共用。 */
export function buildStageObservation(state: GameState, stage: StageState): string {
  const moves = adjacentStageNames(state, stage.id);
  const actorLines =
    stage.actors.length === 0
      ? "无"
      : stage.actors
          .map(
            (actor) =>
              `${actor.name}：${actor.appearance}${actor.status === "dead" ? "（已死亡）" : ""}`,
          )
          .join("\n");
  const itemLines =
    stage.items.length === 0
      ? "无"
      : stage.items.map((item) => `${item.name}（${item.kind}）：${item.description}`).join("\n");
  const moveLines = moves.length === 0 ? "无" : moves.join("、");

  return `# 当前场景

## 场景
${stage.name}
${stage.profile}

## 当前环境
${stage.environment}

## 同场景角色
${actorLines}

## 场景物品
${itemLines}

## 可去场景
${moveLines}

# 本轮任务

你是本场景的小 GM，只能看到本场景的事件与记忆。根据当前环境与本场景记忆，判断并提交更新后的完整 environment。
只有当行动产生了跨场景/世界级后果、会改变其他场景，或需要 world 裁决世界级事实时，才使用 notify_world。判断标准是它是否可能改变场景的通行/封闭、机关或跨场景状态：只有当场景已有信息表明 targetDetail 是功能部位（如锁孔、门闩、机关），并且行动可能改变它时，才在结果不确定时通知。装饰、铭文、表面纹样、物品外观相似都不构成机关，不能据此推测隐藏锁扣；这类行动只更新 environment，不要通知 world。
通知只是报告，不是既成事实；不要因为角色使用了某个物品就自动通知世界。
细节规则见 submit_environment / notify_world 的工具说明；需要更多信息时使用 look_stage / observe_actor。`;
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
    const stageActions = stage.actions as unknown as StageActionKind[];

    if (!plan) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 仲裁结果\n本轮没有提交有效计划，状态未改变。",
          metadata: { kind: MEMORY_KINDS.planFailed, loopSuccess },
        },
      ]);
      return false;
    }

    const hasEnvironment = plan.environment !== undefined;
    const notifications = plan.notifications.slice(0, MAX_STAGE_NOTIFICATIONS_PER_TURN);
    if (notifications.length !== plan.notifications.length) {
      throw new GameError(
        "invalid_state",
        `本轮最多 ${MAX_STAGE_NOTIFICATIONS_PER_TURN} 条 world 通知`,
      );
    }
    if (!hasEnvironment && notifications.length === 0) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 仲裁结果\n本轮没有 environment 或 world 通知，状态未改变。",
          metadata: { kind: MEMORY_KINDS.planFailed, loopSuccess },
        },
      ]);
      return false;
    }

    if (hasEnvironment && !canSubmitEnvironment(stageActions)) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 仲裁结果\n环境更新被拒绝：本场景没有 submit_environment 能力。",
          metadata: { kind: MEMORY_KINDS.actionRejected },
        },
      ]);
      return false;
    }
    if (notifications.length > 0 && !canNotifyWorld(stageActions)) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 仲裁结果\n通知被拒绝：本场景没有 notify_world 能力。",
          metadata: { kind: MEMORY_KINDS.actionRejected },
        },
      ]);
      return false;
    }

    if (hasEnvironment) {
      try {
        assertEnvironmentHasNoActorNames(plan.environment as string, stageActors);
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
    }

    if (newMessages.length > 0) {
      await appendMemoryMessages(tx, memory.row.id, [...newMessages]);
    }

    const now = new Date();
    let changed = false;

    if (hasEnvironment) {
      await tx
        .update(stages)
        .set({ environment: plan.environment as string })
        .where(eq(stages.id, stage.id));
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
      changed = true;
    }

    for (const notification of notifications) {
      await appendWorldNotification(tx, gameId, world.id, stage, notification);
      await appendStageEvent(
        tx,
        gameId,
        stage.id,
        `# 场景事件\n${stage.name}向世界发出通知：${notification}`,
        { eventKind: "world_notification" },
      );
      changed = true;
    }

    if (!changed) {
      return false;
    }
    await bumpGameVersion(tx, gameId, now);
    return true;
  });
}

/**
 * 为单个 stage 跑一轮小 GM agent loop，应用 environment/通知并返回最新状态。
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
  const observeTool = buildObserveActorTool(stage.actors.map((actor) => actor.name));
  const canSubmit = canSubmitEnvironment(stage.actions);
  const canNotify = canNotifyWorld(stage.actions);
  const submitTool = buildSubmitEnvironmentTool();
  const notifyTool = buildNotifyWorldTool();
  const notifications: string[] = [];
  let submitted: StagePlan | null = null;

  const loop = await agentLoop({
    name: stage.name,
    inputMessage: buildStageObservation(state, stage),
    messages: memory.messages,
    tools: [
      lookTool,
      observeTool,
      ...(canSubmit ? [submitTool] : []),
      ...(canNotify ? [notifyTool] : []),
    ],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return lookStage(state, stageName);
      },
      [observeTool.function.name]: (args) => {
        const targetActorName =
          typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
        const target = stage.actors.find((actor) => actor.name === targetActorName);
        if (!target) {
          return `错误：当前场景内找不到角色 ${targetActorName}`;
        }
        return describeObservedActor(target);
      },
      ...(canSubmit
        ? {
            [submitTool.function.name]: (args: Record<string, unknown>) => {
              if (submitted) {
                throw new GameError("invalid_action", "计划已提交");
              }
              const environment = parseEnvironment(args);
              if (environment === undefined && notifications.length === 0) {
                throw new GameError(
                  "invalid_action",
                  "计划必须包含 environment 或至少一条 notify_world 通知",
                );
              }
              submitted = {
                ...(environment !== undefined ? { environment } : {}),
                notifications: [...notifications],
              };
              return "计划已提交";
            },
          }
        : {}),
      ...(canNotify
        ? {
            [notifyTool.function.name]: (args: Record<string, unknown>) => {
              if (notifications.length >= MAX_STAGE_NOTIFICATIONS_PER_TURN) {
                throw new GameError(
                  "invalid_action",
                  `本轮最多 ${MAX_STAGE_NOTIFICATIONS_PER_TURN} 条 world 通知`,
                );
              }
              notifications.push(parseWorldNotification(args));
              // 模型可能先 submit_environment 再 notify_world；通知仍属于同一轮计划，
              // 因此提交后继续补充通知，而不是丢弃或报错。
              if (submitted) {
                submitted = { ...submitted, notifications: [...notifications] };
              }
              return "通知已加入本轮计划";
            },
          }
        : {}),
    },
    terminalTools: canSubmit ? [submitTool] : [],
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
