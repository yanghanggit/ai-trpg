import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, stages, worlds } from "../../db/schema";
import { type TraceContext, traceEvent } from "../../debug/trace";
import type { ChatCompletionService } from "../../llm/protocol";
import type { Logger } from "../../logging";
import { applyAnnounce } from "../actions/announce";
import { applyBrawl } from "../actions/brawl";
import { applyCall } from "../actions/call";
import { applyEquip } from "../actions/equip";
import { applyGive } from "../actions/give";
import { applyMove } from "../actions/move";
import { applyPickup } from "../actions/pickup";
import { applySay } from "../actions/say";
import { applySteal } from "../actions/steal";
import { applyStrike } from "../actions/strike";
import { applyTeleport } from "../actions/teleport";
import { applyUnequip } from "../actions/unequip";
import { applyUse } from "../actions/use";
import { applyWait } from "../actions/wait";
import { applyWhisper } from "../actions/whisper";
import type { AddressLookup } from "../addressing";
import { type AffixRequest, runAffixEffect } from "../affixes";
import { runAppearanceTurn } from "../appearance";
import { MAX_ACTIONS_PER_TURN, MEMORY_KINDS } from "../constants";
import { settleDeaths } from "../death";
import type { DialogueJudge } from "../dialogue-audit";
import { GameError } from "../errors";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import { auditTurnNameLeaks, nameAuditEnabled, nameAuditSince } from "../name-audit";
import { upsertSignatureName } from "../persistence/signature-names";
import { sanitizeActorFacingText } from "../text-guard";
import type { ActorPlan, CommunicationKind, DeathPhaseResult } from "../types";
import { bumpGameVersion } from "./messages";
import { isAlive, listStageActorRefs, stageAddressLookup } from "./queries";

export * from "./queries";

import { describeMemoryState } from "./memory-snapshot";
import { resolvePlan } from "./resolve";
import type { ActorWithStageRow, Executor, ResolvedAction } from "./types";

/** 台词动作的行动反馈也带结构化台词信息；其他动作没有台词。 */
function dialogueFeedbackMetadata(action: ResolvedAction): {
  communicationKind?: CommunicationKind;
  dialogue?: string;
} {
  switch (action.kind) {
    case "say":
    case "whisper":
    case "announce":
    case "call":
      return { communicationKind: action.kind, dialogue: action.action.message };
    default:
      return {};
  }
}

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
    case "call":
      return applyCall(executor, gameId, resolved, now, trace);
    case "move":
      return applyMove(executor, gameId, actorRow, resolved, now, trace);
    case "teleport":
      return applyTeleport(executor, gameId, actorRow, resolved, now, trace);
    case "wait":
      return applyWait(executor, gameId, actorRow, resolved, now, trace);
    case "strike":
      return applyStrike(executor, gameId, actorRow, resolved, now, address, trace);
    case "brawl":
      return applyBrawl(executor, gameId, actorRow, resolved, now, address, trace);
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
): AffixRequest | null {
  if (resolved.kind === "strike" && resolved.item.affixes.length > 0) {
    return {
      actorId,
      itemId: resolved.item.id,
      actionKind: "strike",
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
      ...(resolved.targetAnchor ? { targetAnchor: resolved.targetAnchor } : {}),
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
  /** 玩家对话审核器；默认使用 DeepSeek flash，测试可注入。 */
  judge?: DialogueJudge;
  /** 词缀补充效果需要 LLM agent。 */
  service?: ChatCompletionService;
  /** 死亡阶段的外观快照需要 LLM；不传则跳过（下次 hp 变化或显式调用再补）。 */
  appearanceService?: ChatCompletionService;
  /** 死亡阶段的失败只进日志与返回值，不抛给调用方。 */
  logger?: Logger;
  /** 回合轨迹；有值时记录计划、拒绝、落账与子阶段结果。 */
  trace?: TraceContext;
  /** 回合结束后审计新增的 actor 记忆；默认读 TRPG_AUDIT_NAMES。 */
  auditNameLeaks?: boolean;
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
  const nameAuditStartedAt = nameAuditSince();
  const auditNames = async (): Promise<void> => {
    if (!(options.auditNameLeaks ?? nameAuditEnabled())) {
      return;
    }
    await auditTurnNameLeaks(db, gameId, nameAuditStartedAt, {
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.trace ? { trace: options.trace } : {}),
    });
  };
  let appearanceActorName: string | null = null;
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
    appearanceActorName = actorRow.actor.name;
    if (!isAlive(actorRow.actor)) {
      throw new GameError("invalid_action", `actor 已死亡: ${actorRow.actor.name}`);
    }
    const memory = await loadAgentMemory(tx, gameId, "actor", actorId);
    if (!memory) {
      throw new GameError("invalid_state", `actor 缺少 memory: ${actorId}`);
    }

    /** 计划失败与被拒绝也带当时状态；状态取事务内当前最终状态。 */
    const appendMemoryResult = async (
      content: string,
      metadata: Record<string, unknown>,
    ): Promise<void> => {
      const state = await describeMemoryState(tx, gameId, actorId, world.id);
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: state ? `${content}\n\n${state}` : content,
          metadata,
        },
      ]);
    };

    if (!plan || (plan.actions.length === 0 && (plan.identities?.length ?? 0) === 0)) {
      await appendMemoryResult("# 行动结果\n本轮没有提交有效行动计划，状态未改变。", {
        kind: MEMORY_KINDS.planFailed,
        loopSuccess,
      });
      return {
        ok: false,
        rejection: "本轮没有提交有效行动计划",
        rejectionCode: MEMORY_KINDS.planFailed,
      };
    }

    if (plan.actions.length > MAX_ACTIONS_PER_TURN) {
      const rejection = `本轮最多 ${MAX_ACTIONS_PER_TURN} 个行动，实际提交 ${plan.actions.length} 个`;
      await appendMemoryResult(`# 行动结果\n行动被拒绝：${rejection}。`, {
        kind: MEMORY_KINDS.actionRejected,
      });
      return { ok: false, rejection, rejectionCode: MEMORY_KINDS.actionRejected };
    }

    let resolved: Awaited<ReturnType<typeof resolvePlan>>;
    try {
      resolved = await resolvePlan(tx, world, actorRow, plan);
    } catch (error) {
      if (!(error instanceof GameError)) {
        throw error;
      }
      // 写进记忆的那份要脱敏：CLI/trace 保留名字，actor 记忆只留引用。
      const rejectionAddress = await stageAddressLookup(
        tx,
        gameId,
        actorRow.actor.id,
        actorRow.stage.id,
      );
      const rejectionForMemory = sanitizeActorFacingText(
        error.message,
        await listStageActorRefs(tx, actorRow.stage.id),
        rejectionAddress,
        [],
        { resolveHandles: false },
      );
      await appendMemoryResult(`# 行动结果\n行动被拒绝：${rejectionForMemory}`, {
        kind: MEMORY_KINDS.actionRejected,
      });
      return {
        ok: false,
        rejection: error.message,
        rejectionCode: MEMORY_KINDS.actionRejected,
      };
    }

    const now = new Date();
    const address = await stageAddressLookup(tx, gameId, actorRow.actor.id, actorRow.stage.id);
    const stageActorRefs = await listStageActorRefs(tx, actorRow.stage.id);
    const applied: { event: "applied"; actionKind: string; feedback: string }[] = [];
    const pendingMemory: { content: string; metadata: Record<string, unknown> }[] = [];
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
      const affixRequest = affixRequestFor(action, actorRow.actor.id, feedback);
      if (affixRequest) {
        affixRequests.push(affixRequest);
      }
      const dialogue = dialogueFeedbackMetadata(action);
      pendingMemory.push({
        // 台词原文是角色说出口的内容，保留原样；只有非台词的反馈才做名字脱敏。
        content:
          dialogue.dialogue === undefined
            ? sanitizeActorFacingText(feedback, stageActorRefs, address, [], {
                resolveHandles: false,
              })
            : feedback,
        metadata: {
          kind: MEMORY_KINDS.actionFeedback,
          ...dialogue,
        },
      });
    }

    // 名字更新：只写自己的记忆，不产生公共事件；与动作同事务，失败整份丢弃。
    for (const identity of resolved.identities) {
      await upsertSignatureName(
        tx,
        {
          gameId,
          observerActorId: actorRow.actor.id,
          signatureId: identity.signatureId,
          name: identity.name,
          source: "self",
          learnedStageId: actorRow.stage.id,
        },
        now,
      );
      pendingMemory.push({
        content: `# 认知\n你把 ${identity.handle} 记作「${identity.name}」。`,
        metadata: { kind: MEMORY_KINDS.identityUpdate },
      });
    }
    // 认知更新写进了状态（`signatureNames` 在 GameState 里），却没有任何动作替它推动版本；
    // 只有认知的空手计划必须自己 bump，否则这次写入对 `expectedVersion` 是隐形的。
    // 有计划内动作时版本已经动过，不重复计一次。
    if (resolved.identities.length > 0 && resolved.actions.length === 0) {
      await bumpGameVersion(tx, gameId, now);
    }

    // 一次计划的最后一条 memory 带落账后的状态；识名更新也算计划结果的一部分。
    const state = await describeMemoryState(tx, gameId, actorId, world.id);
    const last = pendingMemory.at(-1);
    if (last && state) {
      last.content = `${last.content}\n\n${state}`;
    }
    if (pendingMemory.length > 0) {
      await appendMemoryMessages(
        tx,
        memory.row.id,
        pendingMemory.map((message) => ({ type: "human" as const, ...message })),
      );
    }

    return {
      ok: true,
      affixRequests,
      applied,
    };
  });

  await traceEvent(options.trace, { event: "plan", actions: plan?.actions ?? [] });
  if (!result.ok) {
    await traceEvent(options.trace, {
      event: "rejected",
      code: result.rejectionCode ?? "rejected",
      reason: result.rejection ?? "未知原因",
    });
    await auditNames();
    return result;
  }
  for (const applied of result.applied ?? []) {
    await traceEvent(options.trace, applied);
  }
  if (result.affixRequests && result.affixRequests.length > 0) {
    // 每个物品各自结算：一个失败只丢自己的增量，不影响其余，也不影响已提交的默认效果。
    for (const request of result.affixRequests) {
      await runAffixEffect(db, gameId, request, options.service, options.trace, options.logger);
    }
  }
  // 换装改的是「别人看到的样子」：在事务外补一次外观推理。
  // 失败与死亡阶段一致，只记日志，不回滚已落账的穿戴。
  const equipmentChanged = (result.applied ?? []).some(
    ({ actionKind }) => actionKind === "equip" || actionKind === "unequip",
  );
  if (equipmentChanged && options.appearanceService) {
    if (!appearanceActorName) {
      throw new GameError("invalid_state", `actor 名称缺失: ${actorId}`);
    }
    let failed = false;
    try {
      const appearance = await runAppearanceTurn(db, gameId, appearanceActorName, {
        service: options.appearanceService,
        ...(options.logger ? { logger: options.logger } : {}),
        ...(options.trace ? { trace: options.trace } : {}),
      });
      failed = !appearance.ok;
    } catch (error) {
      failed = true;
      options.logger?.warn("换装后外观重算失败", error);
    }
    await traceEvent(options.trace, {
      event: "phase",
      name: "appearance",
      status: failed ? "failed" : "ok",
    });
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
  await auditNames();
  return result;
}
