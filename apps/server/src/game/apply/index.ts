import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, stages, worlds } from "../../db/schema";
import type { ChatMessage } from "../../llm/types";
import { applyAnnounce } from "../actions/announce";
import { applyAttack } from "../actions/attack";
import { applyGive } from "../actions/give";
import { applyMove } from "../actions/move";
import { applyPickup } from "../actions/pickup";
import { applySay } from "../actions/say";
import { applySteal } from "../actions/steal";
import { applyUse } from "../actions/use";
import { applyWait } from "../actions/wait";
import { applyWhisper } from "../actions/whisper";
import { MAX_ACTIONS_PER_TURN, MEMORY_KINDS } from "../constants";
import { GameError } from "../errors";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import type { ActorPlan } from "../types";
import { resolvePlan } from "./resolve";
import type { ActorWithStageRow, Executor, ResolvedAction } from "./types";

/** 应用单条已校验的动作；dispatch 是扁平 table，没有分类层。 */
async function applyResolvedAction(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAction,
  now: Date,
): Promise<string> {
  switch (resolved.kind) {
    case "say":
      return applySay(executor, gameId, actorRow, resolved, now);
    case "whisper":
      return applyWhisper(executor, gameId, actorRow, resolved, now);
    case "announce":
      return applyAnnounce(executor, gameId, actorRow, resolved, now);
    case "move":
      return applyMove(executor, gameId, actorRow, resolved, now);
    case "wait":
      return applyWait(executor, gameId, actorRow, resolved, now);
    case "attack":
      return applyAttack(executor, gameId, actorRow, resolved, now);
    case "steal":
      return applySteal(executor, gameId, actorRow, resolved, now);
    case "give":
      return applyGive(executor, gameId, actorRow, resolved, now);
    case "pickup":
      return applyPickup(executor, gameId, actorRow, resolved, now);
    case "use":
      return applyUse(executor, gameId, actorRow, resolved, now);
  }
}

/** 应用计划的结果；`rejection` 是给调用方（尤其是玩家入口）看的原因。 */
export type ApplyPlanResult = {
  ok: boolean;
  rejection?: string;
};

/**
 * 校验并应用一次 actor 计划。
 *
 * 计划里的动作按提交顺序执行；非法计划写入拒绝记忆并返回原因。
 * 数据库等意外错误继续抛出，让事务回滚。
 */
export async function applyActorPlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: ActorPlan | null,
  newMessages: readonly ChatMessage[],
  loopSuccess: boolean,
): Promise<ApplyPlanResult> {
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
    const memory = await loadAgentMemory(tx, gameId, "actor", actorId);
    if (!memory) {
      throw new GameError("invalid_state", `actor 缺少 memory: ${actorId}`);
    }

    if (!plan || plan.actions.length === 0) {
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: "# 行动结果\n本轮没有提交有效行动计划，状态未改变。",
          metadata: { kind: MEMORY_KINDS.planFailed, loopSuccess },
        },
      ]);
      return { ok: false, rejection: "本轮没有提交有效行动计划" };
    }

    if (plan.actions.length > MAX_ACTIONS_PER_TURN) {
      const rejection = `本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动，实际提交 ${plan.actions.length} 个`;
      await appendMemoryMessages(tx, memory.row.id, [
        ...newMessages,
        {
          type: "human",
          content: `# 行动结果\n行动被拒绝：${rejection}。`,
          metadata: { kind: MEMORY_KINDS.actionRejected },
        },
      ]);
      return { ok: false, rejection };
    }

    let resolved: ResolvedAction[];
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
      return { ok: false, rejection: error.message };
    }

    if (newMessages.length > 0) {
      await appendMemoryMessages(tx, memory.row.id, [...newMessages]);
    }

    const now = new Date();
    for (const action of resolved) {
      const feedback = await applyResolvedAction(tx, gameId, actorRow, action, now);
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: feedback,
          metadata: { kind: MEMORY_KINDS.actionFeedback },
        },
      ]);
    }

    return { ok: true };
  });
}
