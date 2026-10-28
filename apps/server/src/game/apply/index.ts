import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, stages, worlds } from "../../db/schema";
import { type TraceContext, traceEvent } from "../../debug/trace";
import type { ChatCompletionService } from "../../llm/protocol";
import type { Logger } from "../../logging";
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
import { type AddressLookup, plainEntityName, refOf } from "../addressing";
import { MAX_ACTIONS_PER_TURN, MEMORY_KINDS } from "../constants";
import { settleDeaths } from "../death";
import { GameError } from "../errors";
import { runAffixEffect } from "../item-effects/affix-agent";
import type { AffixRequest } from "../item-effects/types";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import { listKnowledgeForObserver, upsertKnowledge } from "../persistence/knowledge";
import type { ActorPlan, DeathPhaseResult, IdentityWarning } from "../types";
import { isAlive, listActorNamesInWorld } from "./queries";

export * from "./queries";

import { stageAddressLookup } from "./queries";
import { resolvePlan } from "./resolve";
import type { ActorWithStageRow, Executor, ResolvedAction } from "./types";

/** 扁平 dispatch，没有分类层。 */
async function applyResolvedAction(
  executor: Executor,
  gameId: string,
  actorRow: ActorWithStageRow,
  resolved: ResolvedAction,
  now: Date,
  address: AddressLookup,
  trace?: TraceContext,
): Promise<string> {
  switch (resolved.kind) {
    case "say":
      return applySay(executor, gameId, actorRow, resolved, now, address, trace);
    case "whisper":
      return applyWhisper(executor, gameId, actorRow, resolved, now, address, trace);
    case "announce":
      return applyAnnounce(executor, gameId, actorRow, resolved, now, trace);
    case "move":
      return applyMove(executor, gameId, actorRow, resolved, now, trace);
    case "wait":
      return applyWait(executor, gameId, actorRow, resolved, now, trace);
    case "attack":
      return applyAttack(executor, gameId, actorRow, resolved, now, address, trace);
    case "steal":
      return applySteal(executor, gameId, actorRow, resolved, now, address, trace);
    case "give":
      return applyGive(executor, gameId, actorRow, resolved, now, address, trace);
    case "pickup":
      return applyPickup(executor, gameId, actorRow, resolved, now, trace);
    case "use":
      return applyUse(executor, gameId, actorRow, resolved, now, address, trace);
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
  address: AddressLookup,
): AffixRequest | null {
  if (resolved.kind === "attack" && resolved.item && resolved.item.affixes.length > 0) {
    return {
      actorId,
      itemId: resolved.item.id,
      actionKind: "attack",
      targetActorId: resolved.target.id,
      targetLabel: refOf(address(resolved.target.id)),
      defaultFeedback,
    };
  }
  if (resolved.kind === "use" && resolved.transferItem.affixes.length > 0) {
    return {
      actorId,
      itemId: resolved.transferItem.id,
      actionKind: "use",
      ...(resolved.target
        ? { targetActorId: resolved.target.id, targetLabel: refOf(address(resolved.target.id)) }
        : {}),
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
  /** 认知更新的可疑之处；不阻断行动。 */
  identityWarnings?: IdentityWarning[];
};

export type ApplyActorPlanOptions = {
  /** 词缀补充效果需要 LLM agent。 */
  service?: ChatCompletionService;
  /** 死亡阶段的外观快照需要 LLM；不传则跳过（下次 hp 变化或显式调用再补）。 */
  appearanceService?: ChatCompletionService;
  /** 死亡阶段的失败只进日志与返回值，不抛给调用方。 */
  logger?: Logger;
  /** 回合轨迹；有值时记录计划、拒绝、落账与子阶段结果。 */
  trace?: TraceContext;
};

/**
 * 默认效果在事务内提交；词缀 agent 在事务外补结算。LLM 不进入数据库事务。
 *
 * 推理端只做增量：词缀阶段的任何失败（含未配置 service）都只丢增量，不回滚默认效果，
 * 也不阻断随后的死亡阶段。
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

    if (!plan || (plan.actions.length === 0 && (plan.identities?.length ?? 0) === 0)) {
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

    let resolved: Awaited<ReturnType<typeof resolvePlan>>;
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
    const address = await stageAddressLookup(tx, gameId, actorRow.actor.id, actorRow.stage.id);
    const applied: { event: "applied"; actionKind: string; feedback: string }[] = [];
    for (const action of resolved.actions) {
      const feedback = await applyResolvedAction(
        tx,
        gameId,
        actorRow,
        action,
        now,
        address,
        options.trace,
      );
      applied.push({ event: "applied", actionKind: action.kind, feedback });
      const affixRequest = affixRequestFor(action, actorRow.actor.id, feedback, address);
      if (affixRequest) {
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

    // 认知更新：只写自己的记忆，不产生公共事件；与动作同事务，失败整份丢弃。
    const identityWarnings: IdentityWarning[] = [];
    if (resolved.identities.length > 0) {
      const existing = await listKnowledgeForObserver(tx, gameId, actorRow.actor.id);
      const worldActors = await listActorNamesInWorld(tx, world.id);
      const beliefOwners = new Map(existing.map((row) => [row.name, row.presentationId]));
      for (const identity of resolved.identities) {
        if (identity.stageId !== actorRow.stage.id) {
          identityWarnings.push({
            code: "unseen_handle",
            handle: identity.handle,
            name: identity.name,
            subjectActorId: identity.actorId,
            detail: "记名字时，对方不在你所在的场景",
          });
        }
        const owner = beliefOwners.get(identity.name);
        if (owner !== undefined && owner !== identity.presentationId) {
          identityWarnings.push({
            code: "name_collision",
            handle: identity.handle,
            name: identity.name,
            subjectActorId: identity.actorId,
            detail: "你已经用同样的称呼记过另一个形象",
          });
        }
        const clashesWithTrueName = worldActors.some(
          (candidate) =>
            candidate.id !== identity.actorId && plainEntityName(candidate.name) === identity.name,
        );
        if (clashesWithTrueName) {
          identityWarnings.push({
            code: "name_collision",
            handle: identity.handle,
            name: identity.name,
            subjectActorId: identity.actorId,
            detail: "这个称呼与另一个角色的本名相同",
          });
        }
        beliefOwners.set(identity.name, identity.presentationId);
      }
      for (const warning of identityWarnings) {
        options.logger?.warn("名字认知警告", warning);
      }
    }

    for (const identity of resolved.identities) {
      await upsertKnowledge(
        tx,
        {
          gameId,
          observerActorId: actorRow.actor.id,
          presentationId: identity.presentationId,
          name: identity.name,
          source: "self",
          learnedStageId: actorRow.stage.id,
        },
        now,
      );
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: `# 认知\n你把 ${identity.handle} 记作「${identity.name}」。`,
          metadata: { kind: MEMORY_KINDS.identityUpdate },
        },
      ]);
    }

    return {
      ok: true,
      affixRequests,
      applied,
      ...(identityWarnings.length > 0 ? { identityWarnings } : {}),
    };
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
  for (const warning of result.identityWarnings ?? []) {
    await traceEvent(options.trace, { event: "identity_warning", ...warning });
  }

  if (result.affixRequests && result.affixRequests.length > 0) {
    // 每个物品各自结算：一个失败只丢自己的增量，不影响其余，也不影响已提交的默认效果。
    for (const request of result.affixRequests) {
      await runAffixEffect(db, gameId, request, options.service, options.trace, options.logger);
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
