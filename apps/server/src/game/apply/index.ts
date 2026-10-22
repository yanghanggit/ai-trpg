import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, stages, worlds } from "../../db/schema";
import type { ChatMessage } from "../../llm/types";
import { MEMORY_KINDS } from "../actions";
import { GameError } from "../errors";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import type { ActorPlan } from "../types";
import { applyCommunication } from "./communication";
import { applyMovement } from "./movement";
import { resolvePlan } from "./resolve";
import { applySkill } from "./skill";
import type { ActorWithStageRow, Executor, ResolvedIntent } from "./types";

async function applyResolvedIntent(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedIntent,
  now: Date,
): Promise<string> {
  switch (resolved.kind) {
    case "communication":
      return applyCommunication(executor, gameId, actorRow, resolved, now);
    case "movement":
      return applyMovement(executor, gameId, actorRow, resolved, now);
    case "skill":
      return applySkill(executor, gameId, actorRow, resolved, now);
  }
}

/**
 * 校验并应用一次 actor 计划。
 *
 * 计划中的 intent 按调用顺序执行；非法计划写入拒绝记忆并返回 false。
 * 数据库等意外错误继续抛出，让事务回滚。
 */
export async function applyActorPlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: ActorPlan | null,
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
    const [actorRow] = await tx
      .select({ actor: actors, stage: stages })
      .from(actors)
      .innerJoin(stages, eq(actors.stageId, stages.id))
      .where(and(eq(actors.id, actorId), eq(stages.worldId, world.id)))
      .limit(1);
    if (!actorRow) {
      throw new GameError("not_found", `actor 不存在: ${actorId}`);
    }
    if (actorRow.actor.death) {
      throw new GameError("invalid_action", `actor 已死亡: ${actorRow.actor.name}`);
    }
    const memory = await loadAgentMemory(tx, gameId, actorId);
    if (!memory) {
      throw new GameError("invalid_state", `actor 缺少 memory: ${actorId}`);
    }

    if (!plan || plan.intents.length === 0) {
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

    let resolved: ResolvedIntent[];
    try {
      resolved = await resolvePlan(tx, world, actorRow, plan);
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

    if (newMessages.length > 0) {
      await appendMemoryMessages(tx, memory.row.id, [...newMessages]);
    }

    const now = new Date();
    for (const resolvedIntent of resolved) {
      const feedback = await applyResolvedIntent(tx, gameId, actorRow, resolvedIntent, now);
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: feedback,
          metadata: { kind: MEMORY_KINDS.actionFeedback },
        },
      ]);
    }

    return true;
  });
}
