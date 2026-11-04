import { randomUUID } from "node:crypto";
import type { Database } from "../db/pool";
import type { TraceContext } from "../debug/trace";
import { agentLoop } from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import type { ToolDefinition } from "../llm/types";
import type { Logger } from "../logging";
import { isAlive, stageAddressLookup } from "./apply/queries";
import type { Executor } from "./apply/types";
import { STAT_KEYS, type Stats } from "./attributes";
import { MAX_AFFIX_EFFECTS, MEMORY_KINDS } from "./constants";
import { GameError } from "./errors";
import { runIncrementalPhase } from "./incremental";
import { applyDamage } from "./item-effects/damage";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { appendStageMemory } from "./observations";
import { loadActorByNameInStage, loadActorWithStage } from "./persistence/actors";
import { lockGameRow } from "./persistence/games";
import { loadActorItem } from "./persistence/items";
import { loadWorldByGame } from "./persistence/worlds";
import { getGameStateSlice } from "./service";
import type { Affix } from "./types";
import { buildWorldFunctionPrompt, type WorldConstitution } from "./world-function";

type AffixOperation =
  | { kind: "damage"; targetActorHandle: string; amount: number; reason: string }
  | { kind: "effect"; targetActorHandle: string; witnessText: string };

/** 默认 effect 完成后交给词缀系统的输入。 */
export type AffixRequest = {
  actorId: string;
  itemId: string;
  actionKind: "strike" | "brawl" | "use";
  targetActorId?: string;
  targetStageId?: string;
  targetAnchor?: string;
  defaultFeedback: string;
};

/** 属性渲染成 `damage 8、block 2`；未用到的字段不出现，全 0 写“无”。 */
function statsText(stats: Stats): string {
  const parts = STAT_KEYS.filter((key) => stats[key] !== 0).map((key) => `${key} ${stats[key]}`);
  return parts.length > 0 ? parts.join("、") : "无";
}

/**
 * 词缀判定是开放式的：效果由词缀文本决定，所以只给事实与判定口径，不枚举效果类型。
 * 设定注入与信息边界见 `docs/agents.md`、`docs/information-disclosure.md`，词缀语义见 `docs/affixes.md`。
 */
/** 词缀判定的宪法：只有世界与本职能口径，机制在本轮任务里。 */
export function buildAffixSystemPrompt(world: WorldConstitution): string {
  return buildWorldFunctionPrompt(world, "affixes");
}

export function buildAffixPrompt(input: {
  actorName: string;
  actorStats: Stats;
  itemName: string;
  itemDescription: string;
  itemStats: Stats;
  affixes: readonly Affix[];
  defaultFeedback: string;
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

  return `# 词缀任务

默认效果已结算，但不代表词缀生效：是否生效由你判定，并用工具落账。

## 默认效果
${input.defaultFeedback}

## 结算对象
场景：${input.stageName}
持有者：${input.actorName}（${statsText(input.actorStats)}）
物品：${input.itemName}（${statsText(input.itemStats)}）
${input.itemDescription}
词缀：
${input.affixes.map((affix) => `- [${affix.name}]${affix.content}`).join("\n")}
目标：${input.targetName ?? "无角色目标"}
${targetFacts.join("\n")}

## 规则

- **判定**：按语义读词缀的对象、条件、效果与比例，以上方事实判定；同义、上下位都算成立。不成立或工具表达不了 → 什么都不做，不加词缀以外的后果。
- **数值**：物品字段换算，走 damage_target；不叠加默认效果；程度含糊时按特征强弱小幅增减。
- **可见后果**：走 record_effect；不写数值、机制、心理与真名，用“目标”指代；目标倒下也照写。
- **收尾**：无论是否落账，必调 ${input.terminalToolName}。`;
}

function buildTools(targetNames: readonly string[]): {
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
          "对场景中的一个角色追加词缀伤害；amount 是你按词缀换算出的本次补充伤害，不是最终总伤害。",
        parameters: {
          type: "object",
          properties: {
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
          required: ["targetActorHandle", "amount"],
        },
      },
    },
    record: {
      type: "function",
      function: {
        name: "record_effect",
        description: `把词缀造成的可见后果写进场景记忆；不扣血、不改数值，最多 ${MAX_AFFIX_EFFECTS} 条。`,
        parameters: {
          type: "object",
          properties: {
            targetActorHandle: {
              type: "string",
              enum: [...targetNames],
              description: "产生可见后果的目标角色",
            },
            witnessText: {
              type: "string",
              description: "第三人称，旁人可见的事实",
            },
          },
          required: ["targetActorHandle", "witnessText"],
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
  if (item.affixes.length === 0) {
    return {
      actorName: actor.name,
      itemName: item.name,
      evaluation: { kind: "noop", reason: "物品没有词缀" },
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

  const tools = buildTools(targetNames);
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
      affixes: item.affixes,
      defaultFeedback: request.defaultFeedback,
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
        const targetActorHandle =
          typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
        const amount = Number(args.amount);
        if (!targetNames.includes(targetActorHandle) || !Number.isInteger(amount) || amount <= 0) {
          throw new GameError("invalid_action", "damage_target 参数无效");
        }
        operations.push({
          kind: "damage",
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
        const targetActorHandle =
          typeof args.targetActorHandle === "string" ? args.targetActorHandle.trim() : "";
        const witnessText = typeof args.witnessText === "string" ? args.witnessText.trim() : "";
        if (!targetNames.includes(targetActorHandle) || !witnessText) {
          throw new GameError("invalid_action", "record_effect 参数无效");
        }
        if (
          operations.filter((operation) => operation.kind === "effect").length >= MAX_AFFIX_EFFECTS
        ) {
          throw new GameError("invalid_action", `最多记录 ${MAX_AFFIX_EFFECTS} 条词缀后果`);
        }
        operations.push({ kind: "effect", targetActorHandle, witnessText });
        return `已记录对 ${targetActorHandle} 的可见后果`;
      },
      [tools.submit.function.name]: () => {
        submitted = true;
        return "词缀补充效果已提交";
      },
    },
    terminalTools: [tools.submit],
    service,
    maxRounds: 2,
    // 词缀是默认效果已落账后的补充结算：失败只等于少一次补伤害，
    // 不为它在已提交的回合里额外等待重试。
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
    const feedbacks: string[] = [];
    let damage = 0;
    let effects = 0;
    for (const operation of operations) {
      const targetRow = await loadActorByNameInStage(
        tx,
        actorRow.stage.id,
        operation.targetActorHandle,
      );
      if (!targetRow) {
        continue;
      }
      if (operation.kind === "effect") {
        // 目标可能已经被默认效果打死：尸体照样会变。可见事实只进场景记忆，
        // actor 的认知由它自己 pull，不由推理端写入。
        await appendStageMemory(
          tx,
          gameId,
          actorRow.stage.id,
          `# 场景事件\n${operation.witnessText}`,
          { eventKind: request.actionKind, targetActorId: targetRow.id },
          trace,
        );
        effects += 1;
        continue;
      }
      if (!isAlive(targetRow)) {
        continue;
      }
      feedbacks.push(
        await applyDamage(
          {
            executor: tx as Executor,
            gameId,
            actorRow,
            stage: actorRow.stage,
            address: await stageAddressLookup(tx, gameId, request.actorId, actorRow.stage.id),
            actionKind: request.actionKind,
            effect: itemRow.effect,
            item: itemRow,
            target: targetRow,
            now,
            via: "affix",
            ...(trace ? { trace } : {}),
          },
          operation.amount,
        ),
      );
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

/**
 * 执行一个物品的补充 affix agent；默认效果已提交后调用。
 *
 * 约束：任何失败都只等于「这次没有补伤害」，不外抛，也不影响已提交的默认效果。
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
          reason: "落账时目标已倒下或已离开场景",
          ...head,
          detail: { ...subject, operations: evaluation.operations.length },
        };
      }
      return { kind: "applied", ...head, detail: { ...subject, ...applied } };
    },
  );
}
