import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, stages, worlds } from "../../db/schema";
import type { ChatCompletionService } from "../../llm/protocol";
import type { ChatMessage } from "../../llm/types";
import { applyAnnounce } from "../actions/announce";
import { applyAttack } from "../actions/attack";
import { applyEquip } from "../actions/equip";
import { applyGive } from "../actions/give";
import { applyMove } from "../actions/move";
import { applyPickup } from "../actions/pickup";
import { applySay } from "../actions/say";
import { applySteal } from "../actions/steal";
import { applyUnequip } from "../actions/unequip";
import { applyUse } from "../actions/use";
import { applyWait } from "../actions/wait";
import { applyWhisper } from "../actions/whisper";
import { MAX_ACTIONS_PER_TURN, MEMORY_KINDS } from "../constants";
import { settleDeaths } from "../death";
import { GameError } from "../errors";
import { runAffixEffect } from "../item-effects/affix-agent";
import type { AffixRequest } from "../item-effects/types";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import type { ActorPlan } from "../types";
import { isAlive } from "./queries";

export * from "./queries";

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
    case "equip":
      return applyEquip(executor, gameId, actorRow, resolved, now);
    case "unequip":
      return applyUnequip(executor, gameId, actorRow, resolved, now);
  }
}

function affixRequestFor(
  resolved: ResolvedAction,
  actorId: string,
  defaultFeedback: string,
): AffixRequest | null {
  if (resolved.kind === "attack" && resolved.item && resolved.item.affixes.length > 0) {
    return {
      actorId,
      itemId: resolved.item.id,
      actionKind: "attack",
      targetActorId: resolved.target.id,
      defaultFeedback,
    };
  }
  if (resolved.kind === "use" && resolved.transferItem.affixes.length > 0) {
    return {
      actorId,
      itemId: resolved.transferItem.id,
      actionKind: "use",
      ...(resolved.target ? { targetActorId: resolved.target.id } : {}),
      ...(resolved.targetStage ? { targetStageId: resolved.targetStage.id } : {}),
      ...(resolved.action.targetDetail ? { targetDetail: resolved.action.targetDetail } : {}),
      defaultFeedback,
    };
  }
  return null;
}

/** 应用计划的结果；`rejection` 是给调用方（尤其是玩家入口）看的原因。 */
export type ApplyPlanResult = {
  ok: boolean;
  rejection?: string;
  affixRequests?: AffixRequest[];
  /** 死亡阶段没跑完的死者名字；下次 hp 变化或显式调用会重试。 */
  deathPending?: string[];
};

export type ApplyActorPlanOptions = {
  /** 词缀补充效果需要 LLM agent。 */
  service?: ChatCompletionService;
  /** 死亡阶段的外观快照需要 LLM；不传则跳过（下次 hp 变化或显式调用再补）。 */
  appearanceService?: ChatCompletionService;
};

/**
 * 校验并应用一次 actor 计划。
 *
 * 默认效果在事务内提交；带词缀的物品在默认效果后收集成 AffixRequest，
 * 事务提交后再运行补充 affix agent。LLM 不进入数据库事务。
 */
export async function applyActorPlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: ActorPlan | null,
  newMessages: readonly ChatMessage[],
  loopSuccess: boolean,
  options: ApplyActorPlanOptions = {},
): Promise<ApplyPlanResult> {
  const affixRequests: AffixRequest[] = [];
  const result = await db.transaction(async (tx) => {
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
    if (!isAlive(actorRow.actor)) {
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
      const affixRequest = affixRequestFor(action, actorRow.actor.id, feedback);
      if (affixRequest) {
        if (!options.service) {
          throw new GameError("invalid_state", `物品词缀需要 LLM service: ${action.kind}`);
        }
        affixRequests.push(affixRequest);
      }
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: feedback,
          metadata: { kind: MEMORY_KINDS.actionFeedback },
        },
      ]);
    }

    return { ok: true, affixRequests };
  });

  if (result.ok && result.affixRequests && result.affixRequests.length > 0 && options.service) {
    for (const request of result.affixRequests) {
      await runAffixEffect(db, gameId, request, options.service);
    }
  }

  // hp 已落库；死亡收尾（外观快照，未来的复活判定）属于死者自己，在事务外跑一遍。
  if (!result.ok) {
    return result;
  }
  const deathPhase = await settleDeaths(db, gameId, {
    ...(options.appearanceService ? { service: options.appearanceService } : {}),
  });
  return deathPhase.pending.length > 0 ? { ...result, deathPending: deathPhase.pending } : result;
}
