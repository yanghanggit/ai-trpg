import { randomUUID } from "node:crypto";
import type { Database } from "../../../db/pool";
import { type TraceContext, traceEvent } from "../../../debug/trace";
import { agentLoop } from "../../../llm/agent-loop";
import type { ChatCompletionService } from "../../../llm/protocol";
import type { Logger } from "../../../logging";
import { applyHit } from "../../combat/hit";
import { describeError, GameError } from "../../errors";
import { getGameStateSlice } from "../../game-state";
import { effectiveSourcesOf, equipmentFinalsOf, guardPower } from "../../gameplay";
import { findTextLeaks, NAME_MARKER_PATTERN } from "../../kernel/addressing";
import { agentAffixes } from "../../kernel/affixes";
import { MAX_AFFIX_WITNESSES } from "../../kernel/limits";
import { isAlive, stageAddressLookup } from "../../lookup";
import { appendMemoryMessages, loadAgentMemory } from "../../memory";
import { MEMORY_KINDS } from "../../memory/kinds";
import { loadActorByNameInStage, loadActorWithStage } from "../../persistence/actors";
import { bumpGameVersion, lockGameRow } from "../../persistence/games";
import { loadActorItem } from "../../persistence/items";
import type { Executor, StageRow } from "../../persistence/rows";
import { loadWorldByGame } from "../../persistence/worlds";
import { hasOnlyKnownPlaceholders } from "../../world-definition/item-schema";
import { buildAffixPrompt, buildAffixSystemPrompt } from "./prompt";
import { buildAffixTools } from "./tools";
import type { AffixOperation, AffixRequest } from "./types";
import { appendWitnessEvent, type WitnessTarget } from "./witness";

/** 一次词缀判定的结果；只有 `applied` 才需要落账。 */
type AffixEvaluation =
  | { kind: "applied"; operations: AffixOperation[] }
  | { kind: "noop"; reason: string }
  | { kind: "failed"; reason: string; detail?: Record<string, unknown> };

type EvaluatedAffix = {
  actorName?: string;
  itemName?: string;
  evaluation: AffixEvaluation;
};

/** 读状态、跑 LLM、得出「要不要落账」；不写库。 */
async function evaluateAffix(
  db: Database,
  gameId: string,
  request: AffixRequest,
  service: ChatCompletionService | undefined,
  trace?: TraceContext,
): Promise<EvaluatedAffix> {
  if (!service) {
    return { evaluation: { kind: "noop", reason: "未配置 LLM service" } };
  }
  const state = await getGameStateSlice(db, gameId);
  if (state.game.status !== "active") {
    return { evaluation: { kind: "noop", reason: "游戏已结束" } };
  }
  const actor = state.world.stages
    .flatMap((stage) => stage.actors)
    .find((candidate) => candidate.id === request.actorId);
  const stage = state.world.stages.find((candidate) =>
    candidate.actors.some((entry) => entry.id === request.actorId),
  );
  const item = actor?.items.find((candidate) => candidate.id === request.itemId);
  if (!actor || !stage || !item) {
    return { evaluation: { kind: "noop", reason: "道具或持有者已不存在" } };
  }
  const affixes = agentAffixes(item, request.trigger);
  if (affixes.length === 0) {
    return {
      actorName: actor.name,
      itemName: item.name,
      evaluation: { kind: "noop", reason: "没有需要 LLM 的词缀" },
    };
  }
  const target = request.targetActorId
    ? state.world.stages
        .flatMap((candidate) => candidate.actors)
        .find((candidate) => candidate.id === request.targetActorId)
    : undefined;
  const targetNames = stage.actors.map((candidate) => candidate.name);
  if (targetNames.length === 0) {
    return {
      actorName: actor.name,
      itemName: item.name,
      evaluation: { kind: "noop", reason: "舞台里没有可结算的角色" },
    };
  }

  const tools = buildAffixTools(
    targetNames,
    affixes.map((affix) => affix.name),
    stage.anchors.map((anchor) => anchor.label),
  );
  const operations: AffixOperation[] = [];
  let submitted = false;
  const loop = await agentLoop({
    name: `${item.name}词缀`,
    inputMessage: buildAffixPrompt({
      actorName: actor.name,
      // 面板给源属性；终值不在角色身上，攻击力由静态结算现算。
      actorStats: effectiveSourcesOf(actor),
      itemName: item.name,
      itemDescription: item.description,
      itemStats: item.stats,
      trigger: request.trigger,
      affixes,
      defaultFeedback: request.defaultFeedback,
      ...(request.staticSettlement ? { staticSettlement: request.staticSettlement } : {}),
      ...(request.staticOutcome ? { staticOutcome: request.staticOutcome } : {}),
      terminalToolName: tools.submitAffix.function.name,
      stageName: stage.name,
      ...(target
        ? {
            targetName: target.name,
            targetForm: target.signature.form,
            targetAppearance: target.appearance.text,
          }
        : {}),
      ...(target ? { targetBlock: guardPower(equipmentFinalsOf(target)) } : {}),
      ...(target ? { targetHp: `${target.hp}/${target.stats.maxHp}` } : {}),
    }),
    messages: [{ type: "system", content: buildAffixSystemPrompt(state.world) }],
    tools: [tools.damageTarget, tools.recordWitness, tools.submitAffix],
    handlers: {
      [tools.damageTarget.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "计划已提交");
        }
        const affixName = typeof args.affixName === "string" ? args.affixName.trim() : "";
        const targetActorHandle =
          typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
        const amount = Number(args.amount);
        if (
          !affixes.some((affix) => affix.name === affixName) ||
          !targetNames.includes(targetActorHandle) ||
          !Number.isInteger(amount) ||
          amount <= 0
        ) {
          throw new GameError("invalid_action", "damage_target 参数无效");
        }
        operations.push({
          kind: "damage",
          affixName,
          targetActorHandle,
          amount,
          reason: typeof args.reason === "string" ? args.reason : "",
        });
        return `已记录对 ${targetActorHandle} 的 ${amount} 点补充伤害`;
      },
      [tools.recordWitness.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "计划已提交");
        }
        const affixName = typeof args.affixName === "string" ? args.affixName.trim() : "";
        const targetActorHandle =
          typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
        const targetAnchor = typeof args.targetAnchor === "string" ? args.targetAnchor.trim() : "";
        const template = typeof args.template === "string" ? args.template.trim() : "";
        const visibility = args.visibility === "target" ? "target" : "stage";
        if (!affixes.some((affix) => affix.name === affixName)) {
          throw new GameError("invalid_action", "record_witness 的 affixName 不在本次词缀里");
        }
        if ((targetActorHandle.length === 0) === (targetAnchor.length === 0)) {
          throw new GameError("invalid_action", "record_witness 需要角色或锚点二选一");
        }
        if (targetActorHandle.length > 0 && !targetNames.includes(targetActorHandle)) {
          throw new GameError("invalid_action", "record_witness 的目标不在当前舞台");
        }
        if (targetAnchor.length > 0 && !stage.anchors.some((a) => a.label === targetAnchor)) {
          throw new GameError("invalid_action", "record_witness 的锚点不存在");
        }
        if (!template || !hasOnlyKnownPlaceholders(template)) {
          throw new GameError("invalid_action", "record_witness 的 template 含未知占位符");
        }
        if (NAME_MARKER_PATTERN.test(template)) {
          throw new GameError("invalid_action", "record_witness 的 template 不能包含 # 标记");
        }
        const leaks = findTextLeaks(template, targetNames);
        if (leaks.length > 0) {
          throw new GameError(
            "invalid_action",
            `template 不能包含名字或编号: ${leaks.map((leak) => leak.token).join("、")}`,
          );
        }
        if (
          operations.filter((operation) => operation.kind === "witness").length >=
          MAX_AFFIX_WITNESSES
        ) {
          throw new GameError("invalid_action", `最多记录 ${MAX_AFFIX_WITNESSES} 条词缀后果`);
        }
        operations.push({
          kind: "witness",
          affixName,
          ...(targetActorHandle.length > 0 ? { targetActorHandle } : {}),
          ...(targetAnchor.length > 0 ? { targetAnchor } : {}),
          template,
          visibility,
        });
        return "已记录可见后果";
      },
      [tools.submitAffix.function.name]: () => {
        submitted = true;
        return "词缀补充效果已提交";
      },
    },
    terminalTools: [tools.submitAffix],
    service,
    maxRounds: 3,
    // 词缀是静态结算后的补充：失败只等于少一次追加，不为它额外等待重试。
    errorRetries: 0,
    loopId: randomUUID(),
    ...(trace ? { trace } : {}),
  });

  if (!loop.success) {
    const failure = loop.rounds
      .flatMap((round) => (round.completion.error ? [round.completion.error] : []))
      .at(-1);
    return {
      actorName: actor.name,
      itemName: item.name,
      evaluation: {
        kind: "failed",
        reason: failure?.message ?? "词缀判定未完成",
        ...(failure ? { detail: { kind: failure.kind } } : {}),
      },
    };
  }
  if (operations.length === 0) {
    return {
      actorName: actor.name,
      itemName: item.name,
      evaluation: { kind: "noop", reason: "判定为不生效" },
    };
  }
  return {
    actorName: actor.name,
    itemName: item.name,
    evaluation: { kind: "applied", operations },
  };
}

/**
 * 落账判定结果，返回真正生效的条数。
 *
 * 约束：结果只写进出手者自己的记忆——目标的感知是延迟的（见 `docs/affixes.md`）。
 */
async function settleAffix(
  db: Database,
  gameId: string,
  request: AffixRequest,
  operations: readonly AffixOperation[],
  trace?: TraceContext,
): Promise<{ damage: number; witnesses: number }> {
  // 增量在自己的事务里落账，所以「这次追加落不了地」要留痕：丢增量是允许的
  // （见 `docs/affixes.md`），静默不是。reason 用稳定短标识，便于按原因聚合。
  const drop = async (reason: string) =>
    traceEvent(trace, {
      event: "phase",
      name: "affix",
      status: "skipped",
      detail: { reason, itemId: request.itemId, trigger: request.trigger },
    });

  return db.transaction(async (tx) => {
    const game = await lockGameRow(tx, gameId);
    if (game?.status !== "active") {
      await drop("game-ended");
      return { damage: 0, witnesses: 0 };
    }
    const world = await loadWorldByGame(tx, gameId);
    if (!world) {
      await drop("world-missing");
      return { damage: 0, witnesses: 0 };
    }
    const actorRow = await loadActorWithStage(tx, request.actorId, world.id);
    if (!actorRow) {
      await drop("actor-gone");
      return { damage: 0, witnesses: 0 };
    }
    const itemRow = await loadActorItem(tx, request.actorId, request.itemId);
    if (!itemRow) {
      // 静态阶段提交之后道具被转手或消耗：这次追加跟着失效。
      await drop("item-gone");
      return { damage: 0, witnesses: 0 };
    }
    const now = new Date();
    const address = await stageAddressLookup(tx, gameId, request.actorId, actorRow.stage.id);
    const feedbacks: string[] = [];
    let damage = 0;
    let witnesses = 0;
    for (const operation of operations) {
      if (operation.kind === "witness") {
        const target: WitnessTarget | undefined = operation.targetActorHandle
          ? await resolveWitnessActor(tx, actorRow.stage, operation.targetActorHandle)
          : operation.targetAnchor
            ? { kind: "anchor", label: operation.targetAnchor }
            : undefined;
        if (!target) {
          continue;
        }
        const feedback = await appendWitnessEvent({
          executor: tx as Executor,
          gameId,
          action: request.trigger,
          stage: actorRow.stage,
          source: actorRow.actor,
          itemName: itemRow.name,
          event: {
            affixName: operation.affixName,
            sourceActorId: actorRow.actor.id,
            target,
            template: operation.template,
            visibility: operation.visibility,
          },
          address,
          ...(trace ? { trace } : {}),
        });
        feedbacks.push(feedback);
        witnesses += 1;
        continue;
      }
      const targetRow = await loadActorByNameInStage(
        tx,
        actorRow.stage.id,
        operation.targetActorHandle,
      );
      if (!targetRow || !isAlive(targetRow)) {
        continue;
      }
      const hit = await applyHit({
        executor: tx as Executor,
        gameId,
        actorRow,
        stage: actorRow.stage,
        target: targetRow,
        damage: operation.amount,
        action: request.trigger,
        itemName: itemRow.name,
        via: "affix",
        now,
        address,
        ...(trace ? { trace } : {}),
      });
      feedbacks.push(hit.feedback);
      damage += 1;
    }
    if (feedbacks.length > 0) {
      // 版本由事务层统一推：这一批增量对它自己的可见性负责。
      await bumpGameVersion(tx, gameId, now);
      const memory = await loadAgentMemory(tx, gameId, "actor", request.actorId);
      if (memory) {
        await appendMemoryMessages(
          tx,
          memory.row.id,
          feedbacks.map((sentence) => ({
            type: "human" as const,
            // 一条增量一条记忆：标题由这里补，与计划落账同形。
            content: `# 行动结果\n${sentence}`,
            metadata: { kind: MEMORY_KINDS.actionFeedback },
          })),
        );
      }
    }
    return { damage, witnesses };
  });
}

async function resolveWitnessActor(
  executor: Executor,
  stage: StageRow,
  handle: string,
): Promise<WitnessTarget | undefined> {
  const target = await loadActorByNameInStage(executor, stage.id, handle);
  return target ? { kind: "actor", actorId: target.id } : undefined;
}

/**
 * 执行一个道具的补充 affix agent；静态词缀已提交后调用。
 *
 * 约束：任何失败都只等于「这次没有补伤害」，不外抛，也不影响已提交的静态结果。
 */
export async function runAffixPhase(
  db: Database,
  gameId: string,
  request: AffixRequest,
  service: ChatCompletionService | undefined,
  trace?: TraceContext,
  logger?: Logger,
): Promise<void> {
  try {
    const { actorName, itemName, evaluation } = await evaluateAffix(
      db,
      gameId,
      request,
      service,
      trace,
    );
    const head = actorName === undefined ? {} : { actorName };
    const subject = itemName === undefined ? {} : { itemName };

    if (evaluation.kind === "failed") {
      await traceEvent(trace, {
        event: "phase",
        name: "affix",
        status: "failed",
        ...head,
        detail: { reason: evaluation.reason, ...subject, ...(evaluation.detail ?? {}) },
      });
      return;
    }
    if (evaluation.kind === "noop") {
      await traceEvent(trace, {
        event: "phase",
        name: "affix",
        status: "skipped",
        ...head,
        detail: { reason: evaluation.reason, ...subject },
      });
      return;
    }

    const applied = await settleAffix(db, gameId, request, evaluation.operations, trace);
    if (applied.damage === 0 && applied.witnesses === 0) {
      await traceEvent(trace, {
        event: "phase",
        name: "affix",
        status: "skipped",
        ...head,
        detail: { reason: "判定成立但落账为空", ...subject },
      });
      return;
    }
    await traceEvent(trace, {
      event: "phase",
      name: "affix",
      status: "ok",
      ...head,
      detail: { ...subject, ...applied },
    });
  } catch (error) {
    // 推理端的失败只等于「这次没有补伤害」：不外抛，也不影响已提交的静态结果。
    logger?.warn(`词缀阶段失败，不影响已结算的结果: ${request.itemId}`, error);
    await traceEvent(trace, {
      event: "phase",
      name: "affix",
      status: "failed",
      detail: { reason: describeError(error) },
    });
  }
}
