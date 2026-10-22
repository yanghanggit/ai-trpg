import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors, gameMessages, games, stageConnections, stages, worlds } from "../db/schema";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ChatMessage, ToolDefinition } from "../llm/types";
import { isPlayerControlled } from "./control";
import { GameError } from "./errors";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { getGameState } from "./service";
import type { ActorState, GameState, NpcPlan, NpcTurnResult, StageState } from "./types";

type Executor = Pick<Database, "select" | "insert" | "update">;

export type NpcTurnOptions = {
  service: ChatCompletionService;
  maxRounds?: number;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
};

type ActorWithStage = {
  actor: ActorState;
  stage: StageState;
};

function allActors(state: GameState): ActorWithStage[] {
  return state.world.stages.flatMap((stage) => stage.actors.map((actor) => ({ actor, stage })));
}

function findActor(state: GameState, ref: string): ActorWithStage {
  const matches = allActors(state).filter(({ actor }) => actor.id === ref || actor.name === ref);
  if (matches.length === 0) {
    throw new GameError("not_found", `actor 不存在: ${ref}`);
  }
  if (matches.length > 1) {
    throw new GameError("invalid_action", `actor 名称不唯一，请使用 id: ${ref}`);
  }
  return matches[0] as ActorWithStage;
}

function adjacentStageNames(state: GameState, stageId: string): string[] {
  const byId = new Map(state.world.stages.map((stage) => [stage.id, stage]));
  return state.world.connections
    .filter((connection) => connection.fromStageId === stageId)
    .map((connection) => byId.get(connection.toStageId)?.name)
    .filter((name): name is string => name !== undefined);
}

function otherActorsInStage(stage: StageState, actorId: string): ActorState[] {
  return stage.actors.filter((actor) => actor.id !== actorId);
}

function buildObservation(state: GameState, current: ActorWithStage): string {
  const moves = adjacentStageNames(state, current.stage.id);
  const others = otherActorsInStage(current.stage, current.actor.id);
  const targets = others.map((actor) => actor.name);
  return [
    "# 当前环境",
    `## 场景\n${current.stage.name}\n${current.stage.environment}\n${current.stage.narrative}`,
    `## 你的状态\n${current.actor.name} | HP ${current.actor.hp}/${current.actor.maxHp}`,
    `## 同场景角色\n${others.length === 0 ? "无" : others.map((actor) => `${actor.name}：${actor.appearance}`).join("\n")}`,
    `## 可交谈对象\n${targets.length === 0 ? "无" : targets.join("、")}`,
    `## 可移动至\n${moves.length === 0 ? "无" : moves.join("、")}`,
    "# 本轮任务",
    "根据当前环境与自己的记忆决定行动，并调用工具提交计划。say 是有目标的公开说话，当前场景所有角色都会听见；whisper 是对一名角色的私下耳语，只有说话者与目标会听见；announce 是无目标的公开说话，当前场景所有角色都会听见。say/whisper 必须填写 targetActorName，announce/wait/move 留空。",
  ].join("\n\n");
}

function buildLookTool(state: GameState): ToolDefinition {
  return {
    type: "function",
    function: {
      name: "look_stage",
      description: "查看当前世界中某个场景的环境、角色与可去方向。只读，可多次调用。",
      parameters: {
        type: "object",
        properties: {
          stageName: {
            type: "string",
            enum: state.world.stages.map((stage) => stage.name),
            description: "要查看的场景名",
          },
        },
        required: ["stageName"],
      },
    },
  };
}

function buildSubmitPlanTool(
  availableStageNames: readonly string[],
  availableTargetActorNames: readonly string[],
): ToolDefinition {
  const targetStageSchema: Record<string, unknown> = {
    type: "string",
    description: "move 时必填：目标场景名",
    ...(availableStageNames.length > 0 ? { enum: availableStageNames } : {}),
  };
  const targetActorSchema: Record<string, unknown> = {
    type: "string",
    description:
      "say 时必填：当前场景内唯一的说话对象；wait/move 时传空字符串。计划提交后由服务端校验。",
    ...(availableTargetActorNames.length > 0 ? { enum: availableTargetActorNames } : {}),
  };

  return {
    type: "function",
    function: {
      name: "submit_action_plan",
      description: "提交本轮 NPC 行动决策；调用后本轮规划结束。",
      parameters: {
        type: "object",
        properties: {
          mind: {
            type: "string",
            description: "第一人称内心独白，控制在 60 字以内",
          },
          actionType: {
            type: "string",
            enum: ["wait", "move", "say", "whisper", "announce"],
            description:
              "wait=留在原地；move=移动到相邻场景；say=对一名角色公开说话；whisper=只对一名角色耳语；announce=无目标向当前场景公开说话",
          },
          targetStageName: targetStageSchema,
          targetActorName: targetActorSchema,
          message: {
            type: "string",
            description: "say 时必填：你要说出的内容",
          },
        },
        required: ["mind", "actionType", "targetActorName"],
      },
    },
  };
}

function lookStage(state: GameState, stageName: string): string {
  const stage = state.world.stages.find((item) => item.name === stageName);
  if (!stage) {
    return `错误：场景不存在 ${stageName}`;
  }
  const linked = state.world.connections
    .filter((connection) => connection.fromStageId === stage.id)
    .map((connection) => state.world.stages.find((item) => item.id === connection.toStageId)?.name)
    .filter((name): name is string => name !== undefined);
  return [
    `场景：${stage.name}`,
    stage.environment,
    stage.narrative,
    `角色：${stage.actors.length === 0 ? "无" : stage.actors.map((actor) => actor.name).join("、")}`,
    `可去：${linked.length === 0 ? "无" : linked.join("、")}`,
  ].join("\n");
}

function parsePlan(args: Record<string, unknown>): NpcPlan {
  const mind = typeof args.mind === "string" ? args.mind.trim() : "";
  const actionType = args.actionType;
  if (
    actionType !== "wait" &&
    actionType !== "move" &&
    actionType !== "say" &&
    actionType !== "whisper" &&
    actionType !== "announce"
  ) {
    throw new GameError("invalid_action", `非法 actionType: ${String(actionType)}`);
  }
  return {
    mind,
    actionType,
    ...(typeof args.targetStageName === "string" ? { targetStageName: args.targetStageName } : {}),
    ...(typeof args.targetActorName === "string"
      ? { targetActorName: args.targetActorName.trim() }
      : {}),
    ...(typeof args.message === "string" ? { message: args.message } : {}),
  };
}

function feedbackForPlan(
  plan: NpcPlan,
  sourceStageName: string,
  targetStage?: StageState,
  targetActor?: { name: string },
): string {
  if (plan.actionType === "wait") {
    return "# 行动结果\n你留在原地，继续观察四周。";
  }
  if (plan.actionType === "say") {
    return `# 行动结果\n你对${targetActor?.name ?? plan.targetActorName ?? "某人"}说（场景：${sourceStageName}）：${plan.message ?? ""}`;
  }
  if (plan.actionType === "announce") {
    return `# 行动结果\n你（场景：${sourceStageName}）公开说：${plan.message ?? ""}`;
  }
  if (plan.actionType === "whisper") {
    return `# 行动结果\n你对${targetActor?.name ?? plan.targetActorName ?? "某人"}耳语（场景：${sourceStageName}）：${plan.message ?? ""}`;
  }
  return `# 行动结果\n你抵达了${targetStage?.name ?? plan.targetStageName ?? "未知场景"}。`;
}

async function appendObserverMessages(
  executor: Executor,
  gameId: string,
  stageId: string,
  actorId: string,
  content: string,
): Promise<void> {
  const observerRows = await executor.select().from(actors).where(eq(actors.stageId, stageId));
  for (const observer of observerRows) {
    if (observer.id === actorId) {
      continue;
    }
    const memory = await loadAgentMemory(executor, gameId, observer.id);
    if (!memory) {
      continue;
    }
    await appendMemoryMessages(executor, memory.row.id, [
      {
        type: "human",
        content,
        metadata: { kind: "environment_observation", stageId },
      },
    ]);
  }
}

async function appendSpeechObservations(
  executor: Executor,
  gameId: string,
  stage: { id: string; name: string },
  speaker: { id: string; name: string },
  mode: "say" | "announce" | "whisper",
  target: { id: string; name: string } | undefined,
  message: string,
): Promise<void> {
  if ((mode === "say" || mode === "whisper") && !target) {
    return;
  }
  const observerRows = await executor.select().from(actors).where(eq(actors.stageId, stage.id));
  for (const observer of observerRows) {
    if (observer.id === speaker.id) {
      continue;
    }
    if (mode === "whisper" && observer.id !== target?.id) {
      continue;
    }
    const memory = await loadAgentMemory(executor, gameId, observer.id);
    if (!memory) {
      continue;
    }
    let content: string;
    if (mode === "whisper") {
      content = `# 你听见\n${speaker.name}对你耳语（场景：${stage.name}）：${message}`;
    } else if (mode === "say") {
      content =
        observer.id === target?.id
          ? `# 你听见\n${speaker.name}对你说（场景：${stage.name}）：${message}`
          : `# 你听见\n${speaker.name}对${target?.name}说（场景：${stage.name}）：${message}`;
    } else {
      content = `# 你听见\n${speaker.name}公开说（场景：${stage.name}）：${message}`;
    }
    await appendMemoryMessages(executor, memory.row.id, [
      {
        type: "human",
        content,
        metadata: {
          kind: "speech_observation",
          visibility: mode === "whisper" ? "private" : "stage",
          stageId: stage.id,
          speakerActorId: speaker.id,
          ...(target ? { targetActorId: target.id } : {}),
        },
      },
    ]);
  }
}

async function nextMessageSequence(executor: Executor, gameId: string): Promise<number> {
  const [maxRow] = await executor
    .select({ value: sql<number>`coalesce(max(${gameMessages.sequence}), 0)` })
    .from(gameMessages)
    .where(eq(gameMessages.gameId, gameId));
  return Number(maxRow?.value ?? 0) + 1;
}

export async function applyActorPlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: NpcPlan | null,
  newMessages: readonly ChatMessage[],
  loopSuccess: boolean,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1).for("update");
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${gameId}`);
    }
    const [world] = await tx.select().from(worlds).where(eq(worlds.gameId, gameId)).limit(1);
    if (!world) {
      throw new GameError("invalid_state", `游戏缺少 world: ${gameId}`);
    }
    const [actorRow] = await tx
      .select({ actor: actors, stage: stages })
      .from(actors)
      .innerJoin(stages, eq(actors.stageId, stages.id))
      .where(and(eq(actors.id, actorId), eq(stages.worldId, world.id)))
      .limit(1);
    if (!actorRow) {
      throw new GameError("not_found", `actor 不存在: ${actorId}`);
    }
    const memory = await loadAgentMemory(tx, gameId, actorId);
    if (!memory) {
      throw new GameError("invalid_state", `actor 缺少 memory: ${actorId}`);
    }

    let ok = false;
    let targetStage: StageState | undefined;
    let targetActor: typeof actors.$inferSelect | undefined;
    let publicMessage:
      | {
          kind: string;
          stageId: string;
          targetActorId?: string;
          visibility: "stage" | "private";
          content: string;
        }
      | undefined;
    let observerText: string | undefined;

    if (!plan) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 行动结果\n本轮没有提交有效行动计划，状态未改变。",
          metadata: { kind: "plan_failed", loopSuccess },
        },
      ]);
      return false;
    }

    try {
      if (
        (plan.actionType === "say" ||
          plan.actionType === "whisper" ||
          plan.actionType === "announce") &&
        (plan.message ?? "").trim().length === 0
      ) {
        throw new GameError("invalid_action", `${plan.actionType} 需要非空 message`);
      }
      if (plan.actionType === "say" || plan.actionType === "whisper") {
        if (!plan.targetActorName) {
          throw new GameError("invalid_action", `${plan.actionType} 需要 targetActorName`);
        }
        const targets = await tx
          .select()
          .from(actors)
          .where(and(eq(actors.stageId, actorRow.stage.id), eq(actors.name, plan.targetActorName)))
          .limit(2);
        if (targets.length !== 1) {
          throw new GameError(
            "invalid_action",
            `当前场景内找不到唯一的目标角色: ${plan.targetActorName}`,
          );
        }
        targetActor = targets[0];
        if (targetActor?.id === actorId) {
          throw new GameError("invalid_action", `不能把 ${plan.actionType} 的目标指定为自己`);
        }
      }
      if (plan.actionType === "move") {
        const [target] = await tx
          .select()
          .from(stages)
          .where(and(eq(stages.worldId, world.id), eq(stages.name, plan.targetStageName ?? "")))
          .limit(1);
        if (!target) {
          throw new GameError("invalid_action", `目标 stage 不存在: ${plan.targetStageName ?? ""}`);
        }
        targetStage = {
          id: target.id,
          name: target.name,
          profile: target.profile,
          environment: target.environment,
          narrative: target.narrative,
          ordinal: target.ordinal,
          actors: [],
        };
        const [connection] = await tx
          .select()
          .from(stageConnections)
          .where(
            and(
              eq(stageConnections.worldId, world.id),
              eq(stageConnections.fromStageId, actorRow.stage.id),
              eq(stageConnections.toStageId, target.id),
            ),
          )
          .limit(1);
        if (!connection) {
          throw new GameError(
            "invalid_action",
            `没有从 ${actorRow.stage.name} 到 ${target.name} 的连接`,
          );
        }
      }

      const now = new Date();
      if (plan.actionType === "move" && targetStage) {
        await tx
          .update(actors)
          .set({ stageId: targetStage.id, updatedAt: now })
          .where(eq(actors.id, actorId));
        await tx
          .update(games)
          .set({ version: sql<number>`${games.version} + 1`, updatedAt: now })
          .where(eq(games.id, gameId));
        publicMessage = {
          kind: "move",
          stageId: targetStage.id,
          visibility: "stage",
          content: `${actorRow.actor.name}从${actorRow.stage.name}走向${targetStage.name}。`,
        };
        observerText = `# 环境变化\n${actorRow.actor.name}从${actorRow.stage.name}进入了${targetStage.name}。`;
      } else if (
        plan.actionType === "say" ||
        plan.actionType === "whisper" ||
        plan.actionType === "announce"
      ) {
        await tx
          .update(games)
          .set({ version: sql<number>`${games.version} + 1`, updatedAt: now })
          .where(eq(games.id, gameId));
        publicMessage = {
          kind: plan.actionType,
          stageId: actorRow.stage.id,
          ...(targetActor ? { targetActorId: targetActor.id } : {}),
          visibility: plan.actionType === "whisper" ? "private" : "stage",
          content: plan.message ?? "",
        };
      } else {
        await tx
          .update(games)
          .set({ version: sql<number>`${games.version} + 1`, updatedAt: now })
          .where(eq(games.id, gameId));
      }

      const feedback = feedbackForPlan(plan, actorRow.stage.name, targetStage, targetActor);
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        { type: "human", content: feedback, metadata: { kind: "action_feedback" } },
      ]);

      if (publicMessage) {
        const sequence = await nextMessageSequence(tx, gameId);
        await tx.insert(gameMessages).values({
          id: randomUUID(),
          gameId,
          sequence,
          kind: publicMessage.kind,
          stageId: publicMessage.stageId,
          speakerActorId: actorId,
          targetActorId: publicMessage.targetActorId ?? null,
          visibility: publicMessage.visibility,
          content: publicMessage.content,
        });
      }

      if (
        (plan.actionType === "say" ||
          plan.actionType === "whisper" ||
          plan.actionType === "announce") &&
        publicMessage
      ) {
        await appendSpeechObservations(
          tx,
          gameId,
          actorRow.stage,
          actorRow.actor,
          plan.actionType,
          targetActor,
          publicMessage.content,
        );
      } else if (observerText && publicMessage) {
        await appendObserverMessages(tx, gameId, publicMessage.stageId, actorId, observerText);
      }

      ok = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: `# 行动结果\n行动被拒绝：${message}`,
          metadata: { kind: "action_rejected" },
        },
      ]);
      ok = false;
    }

    return ok;
  });
}

export async function runNpcTurn(
  db: Database,
  gameRef: string,
  actorRef: string,
  options: NpcTurnOptions,
): Promise<NpcTurnResult> {
  const state = await getGameState(db, gameRef);
  const current = findActor(state, actorRef);
  if (await isPlayerControlled(db, state.game.id, current.actor.id)) {
    throw new GameError("invalid_action", `actor 已被玩家接管: ${current.actor.name}`);
  }
  const memory = await loadAgentMemory(db, state.game.id, current.actor.id);
  if (!memory) {
    throw new GameError("invalid_state", `actor 缺少 memory: ${current.actor.name}`);
  }

  const availableStageNames = adjacentStageNames(state, current.stage.id);
  const availableTargetActorNames = otherActorsInStage(current.stage, current.actor.id).map(
    (actor) => actor.name,
  );
  const lookTool = buildLookTool(state);
  const submitTool = buildSubmitPlanTool(availableStageNames, availableTargetActorNames);
  let submitted: NpcPlan | null = null;

  const loop = await agentLoop({
    name: current.actor.name,
    inputMessage: buildObservation(state, current),
    messages: memory.messages,
    tools: [lookTool, submitTool],
    handlers: {
      [lookTool.function.name]: (args) => {
        const stageName = typeof args.stageName === "string" ? args.stageName : "";
        return lookStage(state, stageName);
      },
      [submitTool.function.name]: (args) => {
        submitted = parsePlan(args);
        return "行动计划已提交";
      },
    },
    terminalTools: [submitTool],
    service: options.service,
    maxRounds: options.maxRounds ?? 4,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
  });

  const newMessages = loop.messages.slice(loop.startIndex, loop.endIndex);
  const ok = await applyActorPlan(
    db,
    state.game.id,
    current.actor.id,
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
