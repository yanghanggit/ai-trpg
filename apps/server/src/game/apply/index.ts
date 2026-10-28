import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, stages, worlds } from "../../db/schema";
import { type TraceContext, traceEvent } from "../../debug/trace";
import type { LlmLogger } from "../../llm/logger";
import type { ChatCompletionService } from "../../llm/protocol";
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
import type { ActorPlan, DeathPhaseResult } from "../types";
import { isAlive } from "./queries";

export * from "./queries";

import { resolvePlan } from "./resolve";
import type { ActorWithStageRow, Executor, ResolvedAction } from "./types";

/** 扁平 dispatch，没有分类层。 */
async function applyResolvedAction(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAction,
  now: Date,
  trace?: TraceContext,
): Promise<string> {
  switch (resolved.kind) {
    case "say":
      return applySay(executor, gameId, actorRow, resolved, now, trace);
    case "whisper":
      return applyWhisper(executor, gameId, actorRow, resolved, now, trace);
    case "announce":
      return applyAnnounce(executor, gameId, actorRow, resolved, now, trace);
    case "move":
      return applyMove(executor, gameId, actorRow, resolved, now, trace);
    case "wait":
      return applyWait(executor, gameId, actorRow, resolved, now, trace);
    case "attack":
      return applyAttack(executor, gameId, actorRow, resolved, now, trace);
    case "steal":
      return applySteal(executor, gameId, actorRow, resolved, now, trace);
    case "give":
      return applyGive(executor, gameId, actorRow, resolved, now, trace);
    case "pickup":
      return applyPickup(executor, gameId, actorRow, resolved, now, trace);
    case "use":
      return applyUse(executor, gameId, actorRow, resolved, now, trace);
    case "equip":
      return applyEquip(executor, gameId, actorRow, resolved, now, trace);
    case "unequip":
      return applyUnequip(executor, gameId, actorRow, resolved, now, trace);
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
  /** 拒绝类别，与写入 memory 的 kind 一致；轨迹按它聚合。 */
  rejectionCode?: string;
  affixRequests?: AffixRequest[];
  /** 实际落账的动作事件（事务提交后才写轨迹）。 */
  applied?: { event: "applied"; actionKind: string; feedback: string }[];
  /** 死亡阶段的结果（含失败与重试信息）；失败不回滚这次行动。 */
  death?: DeathPhaseResult;
  /** 死亡阶段整体没能跑起来的原因（例如数据库错误）；行动本身仍然成功。 */
  deathError?: string;
};

export type ApplyActorPlanOptions = {
  /** 词缀补充效果需要 LLM agent。 */
  service?: ChatCompletionService;
  /** 死亡阶段的外观快照需要 LLM；不传则跳过（下次 hp 变化或显式调用再补）。 */
  appearanceService?: ChatCompletionService;
  /** 死亡阶段的失败只进日志与返回值，不抛给调用方。 */
  logger?: LlmLogger;
  /** 回合轨迹；有值时记录计划、拒绝、落账与子阶段结果。 */
  trace?: TraceContext;
};

/**
 * 默认效果在事务内提交；词缀 agent 在事务外补结算。LLM 不进入数据库事务。
 */
export async function applyActorPlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: ActorPlan | null,
  loopSuccess: boolean,
  options: ApplyActorPlanOptions = {},
): Promise<ApplyPlanResult> {
  const affixRequests: AffixRequest[] = [];
  const result: ApplyPlanResult = await db.transaction(async (tx) => {
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
        {
          type: "human",
          content: "# 行动结果\n本轮没有提交有效行动计划，状态未改变。",
          metadata: { kind: MEMORY_KINDS.planFailed, loopSuccess },
        },
      ]);
      return {
        ok: false,
        rejection: "本轮没有提交有效行动计划",
        rejectionCode: MEMORY_KINDS.planFailed,
      };
    }

    if (plan.actions.length > MAX_ACTIONS_PER_TURN) {
      const rejection = `本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动，实际提交 ${plan.actions.length} 个`;
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: `# 行动结果\n行动被拒绝：${rejection}。`,
          metadata: { kind: MEMORY_KINDS.actionRejected },
        },
      ]);
      return { ok: false, rejection, rejectionCode: MEMORY_KINDS.actionRejected };
    }

    let resolved: ResolvedAction[];
    try {
      resolved = await resolvePlan(tx, world, actorRow, plan);
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: `# 行动结果\n行动被拒绝：${error.message}`,
          metadata: { kind: MEMORY_KINDS.actionRejected },
        },
      ]);
      return {
        ok: false,
        rejection: error.message,
        rejectionCode: MEMORY_KINDS.actionRejected,
      };
    }

    const now = new Date();
    const applied: { event: "applied"; actionKind: string; feedback: string }[] = [];
    for (const action of resolved) {
      const feedback = await applyResolvedAction(tx, gameId, actorRow, action, now, options.trace);
      applied.push({ event: "applied", actionKind: action.kind, feedback });
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

    return { ok: true, affixRequests, applied };
  });

  await traceEvent(options.trace, { event: "plan", actions: plan?.actions ?? [] });
  if (!result.ok) {
    await traceEvent(options.trace, {
      event: "rejected",
      code: result.rejectionCode ?? "rejected",
      reason: result.rejection ?? "未知原因",
    });
    return result;
  }
  for (const applied of result.applied ?? []) {
    await traceEvent(options.trace, applied);
  }

  if (result.affixRequests && result.affixRequests.length > 0 && options.service) {
    for (const request of result.affixRequests) {
      await runAffixEffect(db, gameId, request, options.service, options.trace);
    }
  }
  // 死亡阶段在事务外跑：它要调 LLM，失败也不能回滚这次行动。
  try {
    result.death = await settleDeaths(db, gameId, {
      ...(options.appearanceService ? { service: options.appearanceService } : {}),
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.trace ? { trace: options.trace } : {}),
    });
  } catch (error) {
    // 标记没写成：下一次 hp 变化或 `agent:game deaths` 会再来。
    result.deathError = error instanceof Error ? error.message : String(error);
    options.logger?.warn("死亡阶段失败，下次调用会重试", error);
  }
  return result;
}
