import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import type { TraceContext } from "../debug/trace";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import type { Logger } from "../logging";
import { isAlive, stageAddressLookup } from "./apply/queries";
import type { Executor, StageRow } from "./apply/types";
import { STAT_KEYS, type Stats } from "./attributes";
import { applyHit } from "./combat/hit";
import { MAX_AFFIX_EFFECTS, MEMORY_KINDS } from "./constants";
import { GameError } from "./errors";
import { runIncrementalPhase } from "./incremental";
import { hasOnlyKnownPlaceholders } from "./item-schema";
import { type AffixTrigger, agentAffixes } from "./items/affix-model";
import type { StaticOutcome } from "./items/settle";
import type { StaticSettlement } from "./items/static";
import { appendWitnessEvent, type WitnessTarget } from "./items/witness";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { loadActorByNameInStage, loadActorWithStage } from "./persistence/actors";
import { lockGameRow } from "./persistence/games";
import { loadActorItem } from "./persistence/items";
import { loadWorldByGame } from "./persistence/worlds";
import { getGameStateSlice } from "./read/game-state";
import { NAME_MARKER_PATTERN } from "./reference";
import { findTextLeaks } from "./text-guard";
import type { Affix } from "./types";
import { type WorldConstitution, worldFunctionAgent } from "./world-function";

type AffixOperation =
  | {
      kind: "damage";
      affixName: string;
      targetActorHandle: string;
      amount: number;
      reason: string;
    }
  | {
      kind: "witness";
      affixName: string;
      targetActorHandle?: string;
      targetAnchor?: string;
      template: string;
      visibility: "stage" | "target";
    };

/** 静态阶段完成后交给 agent 阶段的输入。 */
export type AffixRequest = {
  actorId: string;
  itemId: string;
  trigger: AffixTrigger;
  targetActorId?: string;
  targetStageId?: string;
  targetAnchor?: string;
  defaultFeedback: string;
  staticSettlement?: StaticSettlement;
  /** 静态命中落账后的真实结果；没有命中时为 0 / false。 */
  staticOutcome?: StaticOutcome;
};

/** 属性渲染成 `damage 8、block 2`；未用到的字段不出现，全 0 写“无”。 */
function statsText(stats: Stats): string {
  const parts = STAT_KEYS.filter((key) => stats[key] !== 0).map((key) => `${key} ${stats[key]}`);
  return parts.length > 0 ? parts.join("、") : "无";
}

/** 词缀判定的宪法：建局时装配好的完整文本。 */
export function buildAffixSystemPrompt(world: WorldConstitution): string {
  return worldFunctionAgent(world, "affixes").systemPrompt;
}

export function buildAffixPrompt(input: {
  actorName: string;
  actorStats: Stats;
  itemName: string;
  itemDescription: string;
  itemStats: Stats;
  trigger: AffixTrigger;
  affixes: readonly Affix[];
  defaultFeedback: string;
  staticSettlement?: StaticSettlement;
  staticOutcome?: StaticOutcome;
  terminalToolName: string;
  targetName?: string;
  targetForm?: string;
  targetAppearance?: string;
  targetHp?: string;
  targetBlock?: number;
  stageName: string;
}): string {
  const targetFacts = [
    input.targetForm ? `形态：${input.targetForm}` : "",
    input.targetAppearance ? `外观：${input.targetAppearance}` : "",
    input.targetBlock !== undefined ? `block：${input.targetBlock}` : "",
    input.targetHp ? `HP：${input.targetHp}` : "",
  ].filter((line) => line.length > 0);
  const staticFacts =
    input.staticSettlement === undefined
      ? "无（本次没有静态词缀）"
      : [
          ...input.staticSettlement.rendered.map((line) => `- ${line}`),
          input.staticSettlement.hasDamageOps
            ? `静态伤害合计：${input.staticSettlement.rawDamage}，扣除防御后 ${input.staticSettlement.damage}`
            : "静态词缀没有造成伤害",
          ...(input.staticOutcome
            ? [
                `实际造成伤害：${input.staticOutcome.dealtDamage}`,
                `目标 HP 归零：${input.staticOutcome.targetDied ? "是" : "否"}`,
              ]
            : []),
        ].join("\n");

  return `# 词缀任务

静态词缀已结算并提交；你只判定下列 mode=agent 的词缀，用工具追加后果。

## 静态结算
${staticFacts}

## 动作结果
${input.defaultFeedback}

## 结算对象
场景：${input.stageName}
触发：${input.trigger}
持有者：${input.actorName}（${statsText(input.actorStats)}）
物品：${input.itemName}（${statsText(input.itemStats)}）
${input.itemDescription}
词缀：
${input.affixes.map((affix) => `- [${affix.name}]${affix.content}`).join("\n")}
目标：${input.targetName ?? "无角色目标"}
${targetFacts.join("\n")}

## 规则

- **判定**：按语义读词缀的对象、条件、效果与比例，以上方事实判定；同义、上下位都算成立。
- **不要重复**：静态已造成的伤害不要再算一次；你的 damage_target 只追加词缀本身的补充值。
- **数值**：走 damage_target；不叠加静态结算。
- **可见后果**：走 record_effect。template 只能用 {source}/{target}/{anchor}/{item} 占位，禁止写名字、编号或 @；只写旁人可见的事实，不写数值、机制与心理。
- **不成立但过程可见**：可以用 record_effect 记一条可见见证；完全不可见就什么都不做。
- **收尾**：无论是否落账，必调 ${input.terminalToolName}。`;
}

function buildTools(
  targetNames: readonly string[],
  affixNames: readonly string[],
  anchorLabels: readonly string[],
): {
  damage: ToolDefinition;
  record: ToolDefinition;
  submit: ToolDefinition;
} {
  return {
    damage: {
      type: "function",
      function: {
        name: "damage_target",
        description:
          "对场景中的一个角色追加词缀伤害；amount 是本次追加值，不是最终总伤害，也不要重复静态结算。",
        parameters: {
          type: "object",
          properties: {
            affixName: {
              type: "string",
              enum: [...affixNames],
              description: "是哪条词缀产生的追加",
            },
            targetActorHandle: {
              type: "string",
              enum: [...targetNames],
              description: "追加伤害的目标角色",
            },
            amount: {
              type: "integer",
              minimum: 1,
              description: "补充伤害数值",
            },
            reason: {
              type: "string",
              description: "判定依据：目标身上支撑本次追加的特征",
            },
          },
          required: ["affixName", "targetActorHandle", "amount"],
        },
      },
    },
    record: {
      type: "function",
      function: {
        name: "record_effect",
        description: `把词缀造成的可见后果写进场景；不扣血、不改数值，最多 ${MAX_AFFIX_EFFECTS} 条。`,
        parameters: {
          type: "object",
          properties: {
            affixName: {
              type: "string",
              enum: [...affixNames],
              description: "是哪条词缀产生的见证",
            },
            targetActorHandle: {
              type: "string",
              enum: [...targetNames],
              description: "产生可见后果的目标角色",
            },
            ...(anchorLabels.length > 0
              ? {
                  targetAnchor: {
                    type: "string",
                    enum: [...anchorLabels],
                    description: "产生可见后果的锚点（与 targetActorHandle 二选一）",
                  },
                }
              : {}),
            visibility: {
              type: "string",
              enum: ["stage", "target"],
              description: "可见范围：stage 全场景，target 只有当事人",
            },
            template: {
              type: "string",
              description:
                "只允许 {source}/{target}/{anchor}/{item} 占位；不得写名字、编号或 @；第三人称可见事实",
            },
          },
          required: ["affixName", "template"],
        },
      },
    },
    submit: {
      type: "function",
      function: {
        name: "submit_affix",
        description: "结束本轮词缀任务。",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
  };
}

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
    return { evaluation: { kind: "noop", reason: "物品或持有者已不存在" } };
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
      evaluation: { kind: "noop", reason: "场景里没有可结算的角色" },
    };
  }

  const tools = buildTools(
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
      actorStats: actor.stats,
      itemName: item.name,
      itemDescription: item.description,
      itemStats: item.stats,
      trigger: request.trigger,
      affixes,
      defaultFeedback: request.defaultFeedback,
      ...(request.staticSettlement ? { staticSettlement: request.staticSettlement } : {}),
      ...(request.staticOutcome ? { staticOutcome: request.staticOutcome } : {}),
      terminalToolName: tools.submit.function.name,
      stageName: stage.name,
      ...(target
        ? {
            targetName: target.name,
            targetForm: target.signature.form,
            targetAppearance: target.appearance.text,
          }
        : {}),
      ...(target ? { targetBlock: target.stats.block } : {}),
      ...(target ? { targetHp: `${target.hp}/${target.stats.maxHp}` } : {}),
    }),
    messages: [{ type: "system", content: buildAffixSystemPrompt(state.world) }],
    tools: [tools.damage, tools.record, tools.submit],
    handlers: {
      [tools.damage.function.name]: (args) => {
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
      [tools.record.function.name]: (args) => {
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
          throw new GameError("invalid_action", "record_effect 的 affixName 不在本次词缀里");
        }
        if ((targetActorHandle.length === 0) === (targetAnchor.length === 0)) {
          throw new GameError("invalid_action", "record_effect 需要角色或锚点二选一");
        }
        if (targetActorHandle.length > 0 && !targetNames.includes(targetActorHandle)) {
          throw new GameError("invalid_action", "record_effect 的目标不在当前场景");
        }
        if (targetAnchor.length > 0 && !stage.anchors.some((a) => a.label === targetAnchor)) {
          throw new GameError("invalid_action", "record_effect 的锚点不存在");
        }
        if (!template || !hasOnlyKnownPlaceholders(template)) {
          throw new GameError("invalid_action", "record_effect 的 template 含未知占位符");
        }
        if (NAME_MARKER_PATTERN.test(template)) {
          throw new GameError("invalid_action", "record_effect 的 template 不能包含 @ 或 # 标记");
        }
        const leaks = findTextLeaks(template, targetNames);
        if (leaks.length > 0) {
          throw new GameError(
            "invalid_action",
            `template 不能包含名字或编号: ${leaks.map((leak) => leak.token).join("、")}`,
          );
        }
        if (
          operations.filter((operation) => operation.kind === "witness").length >= MAX_AFFIX_EFFECTS
        ) {
          throw new GameError("invalid_action", `最多记录 ${MAX_AFFIX_EFFECTS} 条词缀后果`);
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
      [tools.submit.function.name]: () => {
        submitted = true;
        return "词缀补充效果已提交";
      },
    },
    terminalTools: [tools.submit],
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
): Promise<{ damage: number; effects: number }> {
  return db.transaction(async (tx) => {
    const game = await lockGameRow(tx, gameId);
    if (game?.status !== "active") {
      return { damage: 0, effects: 0 };
    }
    const world = await loadWorldByGame(tx, gameId);
    if (!world) {
      return { damage: 0, effects: 0 };
    }
    const actorRow = await loadActorWithStage(tx, request.actorId, world.id);
    const itemRow = await loadActorItem(tx, request.actorId, request.itemId);
    if (!actorRow || !itemRow) {
      return { damage: 0, effects: 0 };
    }
    const now = new Date();
    const address = await stageAddressLookup(tx, gameId, request.actorId, actorRow.stage.id);
    const feedbacks: string[] = [];
    let damage = 0;
    let effects = 0;
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
        feedbacks.push(`# 行动结果\n${feedback}`);
        effects += 1;
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
      const memory = await loadAgentMemory(tx, gameId, "actor", request.actorId);
      if (memory) {
        await appendMemoryMessages(
          tx,
          memory.row.id,
          feedbacks.map((content) => ({
            type: "human" as const,
            content,
            metadata: { kind: MEMORY_KINDS.actionFeedback },
          })),
        );
      }
    }
    return { damage, effects };
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
 * 执行一个物品的补充 affix agent；静态词缀已提交后调用。
 *
 * 约束：任何失败都只等于「这次没有补伤害」，不外抛，也不影响已提交的静态结果。
 */
export async function runAffixEffect(
  db: Database,
  gameId: string,
  request: AffixRequest,
  service: ChatCompletionService | undefined,
  trace?: TraceContext,
  logger?: Logger,
): Promise<void> {
  await runIncrementalPhase(
    { name: "affix", ...(trace ? { trace } : {}), ...(logger ? { logger } : {}) },
    async () => {
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
        return {
          kind: "failed",
          reason: evaluation.reason,
          ...head,
          detail: { ...subject, ...(evaluation.detail ?? {}) },
        };
      }
      if (evaluation.kind === "noop") {
        return { kind: "noop", reason: evaluation.reason, ...head, detail: subject };
      }
      const applied = await settleAffix(db, gameId, request, evaluation.operations, trace);
      if (applied.damage === 0 && applied.effects === 0) {
        return {
          kind: "noop",
          reason: "判定成立但落账为空",
          ...head,
          detail: subject,
        };
      }
      return {
        kind: "applied",
        ...head,
        detail: { ...subject, ...applied },
      };
    },
  );
}
