import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors, gameMessages, games, stageConnections, stages, worlds } from "../db/schema";
import type { ChatMessage } from "../llm/types";
import {
  isSpeechAction,
  MEMORY_KINDS,
  type MessageVisibility,
  visibilityForSpeech,
} from "./actions";
import { GameError } from "./errors";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { appendEnvironmentObservations, appendSpeechObservations } from "./observations";
import type { ActorActionPlan, StageState } from "./types";

type Executor = Pick<Database, "select" | "insert" | "update">;
type WorldRow = typeof worlds.$inferSelect;
type ActorRow = typeof actors.$inferSelect;
type ActorWithStageRow = { actor: ActorRow; stage: typeof stages.$inferSelect };

type PublicMessage = {
  kind: string;
  stageId: string;
  targetActorId?: string;
  visibility: MessageVisibility;
  content: string;
};

type PlanTargets = {
  targetStage?: StageState;
  targetActor?: ActorRow;
};

type StateChange = {
  publicMessage?: PublicMessage;
  observerText?: string;
};

/** 读取并校验计划涉及的目标；非法计划抛 GameError。 */
async function resolvePlanTargets(
  executor: Executor,
  world: WorldRow,
  actorRow: ActorWithStageRow,
  plan: ActorActionPlan,
): Promise<PlanTargets> {
  if (isSpeechAction(plan.actionType) && (plan.message ?? "").trim().length === 0) {
    throw new GameError("invalid_action", `${plan.actionType} 需要非空 message`);
  }

  let targetActor: ActorRow | undefined;
  if (plan.actionType === "say" || plan.actionType === "whisper") {
    if (!plan.targetActorName) {
      throw new GameError("invalid_action", `${plan.actionType} 需要 targetActorName`);
    }
    const targets = await executor
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
    if (targetActor?.id === actorRow.actor.id) {
      throw new GameError("invalid_action", `不能把 ${plan.actionType} 的目标指定为自己`);
    }
  }

  let targetStage: StageState | undefined;
  if (plan.actionType === "move") {
    const [target] = await executor
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
    const [connection] = await executor
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

  return { targetStage, targetActor };
}

async function bumpGameVersion(executor: Executor, gameId: string, now: Date): Promise<void> {
  await executor
    .update(games)
    .set({ version: sql<number>`${games.version} + 1`, updatedAt: now })
    .where(eq(games.id, gameId));
}

async function applyStateChange(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  plan: ActorActionPlan,
  targets: PlanTargets,
  now: Date,
): Promise<StateChange> {
  if (plan.actionType === "move" && targets.targetStage) {
    await executor
      .update(actors)
      .set({ stageId: targets.targetStage.id, updatedAt: now })
      .where(eq(actors.id, actorRow.actor.id));
    await bumpGameVersion(executor, gameId, now);
    return {
      publicMessage: {
        kind: "move",
        stageId: targets.targetStage.id,
        visibility: "stage",
        content: `${actorRow.actor.name}从${actorRow.stage.name}走向${targets.targetStage.name}。`,
      },
      observerText: `# 环境变化\n${actorRow.actor.name}从${actorRow.stage.name}进入了${targets.targetStage.name}。`,
    };
  }

  await bumpGameVersion(executor, gameId, now);
  if (!isSpeechAction(plan.actionType)) {
    return {};
  }

  return {
    publicMessage: {
      kind: plan.actionType,
      stageId: actorRow.stage.id,
      ...(targets.targetActor ? { targetActorId: targets.targetActor.id } : {}),
      visibility: visibilityForSpeech(plan.actionType),
      content: plan.message ?? "",
    },
  };
}

function feedbackForPlan(
  plan: ActorActionPlan,
  sourceStageName: string,
  targets: PlanTargets,
): string {
  if (plan.actionType === "wait") {
    return "# 行动结果\n你留在原地，继续观察四周。";
  }
  if (plan.actionType === "say") {
    return `# 行动结果\n你对${targets.targetActor?.name ?? plan.targetActorName ?? "某人"}说（场景：${sourceStageName}）：${plan.message ?? ""}`;
  }
  if (plan.actionType === "announce") {
    return `# 行动结果\n你（场景：${sourceStageName}）公开说：${plan.message ?? ""}`;
  }
  if (plan.actionType === "whisper") {
    return `# 行动结果\n你对${targets.targetActor?.name ?? plan.targetActorName ?? "某人"}耳语（场景：${sourceStageName}）：${plan.message ?? ""}`;
  }
  return `# 行动结果\n你抵达了${targets.targetStage?.name ?? plan.targetStageName ?? "未知场景"}。`;
}

async function appendPublicMessage(
  executor: Executor,
  gameId: string,
  actorId: string,
  message: PublicMessage,
): Promise<void> {
  const [maxRow] = await executor
    .select({ value: sql<number>`coalesce(max(${gameMessages.sequence}), 0)` })
    .from(gameMessages)
    .where(eq(gameMessages.gameId, gameId));
  const sequence = Number(maxRow?.value ?? 0) + 1;

  await executor.insert(gameMessages).values({
    id: randomUUID(),
    gameId,
    sequence,
    kind: message.kind,
    stageId: message.stageId,
    speakerActorId: actorId,
    targetActorId: message.targetActorId ?? null,
    visibility: message.visibility,
    content: message.content,
  });
}

/**
 * 校验并应用一次 actor 行动。
 *
 * 非法计划写入拒绝记忆并返回 false；数据库等意外错误继续抛出，让事务回滚。
 */
export async function applyActorPlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: ActorActionPlan | null,
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

    if (!plan) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 行动结果\n本轮没有提交有效行动计划，状态未改变。",
          metadata: { kind: MEMORY_KINDS.planFailed, loopSuccess },
        },
      ]);
      return false;
    }

    let targets: PlanTargets;
    try {
      targets = await resolvePlanTargets(tx, world, actorRow, plan);
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: `# 行动结果\n行动被拒绝：${error.message}`,
          metadata: { kind: MEMORY_KINDS.actionRejected },
        },
      ]);
      return false;
    }

    const now = new Date();
    const change = await applyStateChange(tx, gameId, actorRow, plan, targets, now);
    await appendMemoryMessages(tx, memory.row.id, [
      ...newMessages,
      {
        type: "human",
        content: feedbackForPlan(plan, actorRow.stage.name, targets),
        metadata: { kind: MEMORY_KINDS.actionFeedback },
      },
    ]);

    if (change.publicMessage) {
      await appendPublicMessage(tx, gameId, actorId, change.publicMessage);
    }

    if (isSpeechAction(plan.actionType) && change.publicMessage) {
      await appendSpeechObservations(
        tx,
        gameId,
        actorRow.stage,
        actorRow.actor,
        plan.actionType,
        targets.targetActor,
        change.publicMessage.content,
      );
    } else if (change.observerText && change.publicMessage) {
      await appendEnvironmentObservations(
        tx,
        gameId,
        change.publicMessage.stageId,
        actorId,
        change.observerText,
      );
    }

    return true;
  });
}
