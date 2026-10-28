import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import type { TraceContext } from "../../debug/trace";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import type { ToolDefinition } from "../../llm/types";
import type { Logger } from "../../logging";
import { isAlive } from "../apply/queries";
import type { Executor } from "../apply/types";
import { STAT_KEYS, type Stats } from "../attributes";
import { MAX_AFFIX_EFFECT_LENGTH, MAX_AFFIX_EFFECTS, MEMORY_KINDS } from "../constants";
import { GameError } from "../errors";
import { runIncrementalPhase } from "../incremental";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import { appendSelfObservation, appendStageMemory } from "../observations";
import { loadActorByNameInStage, loadActorWithStage } from "../persistence/actors";
import { lockGameRow } from "../persistence/games";
import { loadActorItem } from "../persistence/items";
import { loadWorldByGame } from "../persistence/worlds";
import { getGameState } from "../service";
import type { Affix } from "../types";
import { applyDamage } from "./damage";
import type { AffixRequest } from "./types";

type AffixOperation =
  | { kind: "damage"; targetActorName: string; amount: number; reason: string }
  | { kind: "effect"; targetActorName: string; experience: string; witnessText: string };

/** 属性渲染成 `damage 8、block 2`；未用到的字段不出现，全 0 写“无”。 */
function statsText(stats: Stats): string {
  const parts = STAT_KEYS.filter((key) => stats[key] !== 0).map((key) => `${key} ${stats[key]}`);
  return parts.length > 0 ? parts.join("、") : "无";
}

/**
 * 词缀任务的提示词。
 *
 * 词缀是自然语言规则，可由 agent-loop 做任意事；伤害只是当前已注册的其中一种效果。
 * 所以这里只给事实（持有者、物品、目标）与判定口径，不预设效果类型，也不写死工具名：
 * 字段级细则（人称、条数上限）留在工具描述里，这里只写判定与结算规则。
 */
function buildAffixPrompt(input: {
  actorName: string;
  actorStats: Stats;
  itemName: string;
  itemDescription: string;
  itemStats: Stats;
  affixes: readonly Affix[];
  defaultFeedback: string;
  terminalToolName: string;
  targetName?: string;
  targetRace?: string;
  targetAppearance?: string;
  targetHp?: string;
  targetBlock?: number;
  stageName: string;
}): string {
  const targetFacts = [
    input.targetRace ? `种族：${input.targetRace}` : "",
    input.targetAppearance ? `外观：${input.targetAppearance}` : "",
    input.targetBlock !== undefined ? `block：${input.targetBlock}` : "",
    input.targetHp ? `HP：${input.targetHp}` : "",
  ].filter((line) => line.length > 0);

  return `# 词缀任务

默认效果已结算（见下），不代表词缀生效；词缀是否生效由你判定并用工具落账。

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

1. 按语义读词缀的对象、条件、效果与比例，用目标的名字、种族、外观与当前状态判定；同义或上下位表述都算成立，不按字面排除。
2. 条件成立才执行；不成立或工具表达不了该效果时，只结束任务，不附加词缀以外的后果。
3. 数值取物品自身的字段换算，与默认效果无关；程度留有余地时按特征强弱小幅增减。
4. 数值后果用 damage_target，可见后果用 record_effect；只写本条词缀造成的感官变化，不写数值、机制或心理。
5. 最后用 ${input.terminalToolName} 结束，即使什么都没做。`;
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
            targetActorName: {
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
          required: ["targetActorName", "amount"],
        },
      },
    },
    record: {
      type: "function",
      function: {
        name: "record_effect",
        description: `把这条词缀造成的可见后果写进目标记忆与场景记忆；不扣血、不改数值，最多 ${MAX_AFFIX_EFFECTS} 条。experience 用第二人称写目标亲身经历，witnessText 用第三人称写旁人可见的事实。`,
        parameters: {
          type: "object",
          properties: {
            targetActorName: {
              type: "string",
              enum: [...targetNames],
              description: "产生可见后果的目标角色",
            },
            experience: {
              type: "string",
              description: "第二人称，写目标的亲身体验与感受",
            },
            witnessText: {
              type: "string",
              description: "第三人称，写场景与他人可见的事实",
            },
          },
          required: ["targetActorName", "experience", "witnessText"],
        },
      },
    },
    submit: {
      type: "function",
      function: {
        name: "submit_affix",
        description: "结束本轮词缀任务；没有可执行的效果也必须调用。",
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
  const state = await getGameState(db, gameId);
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
            targetRace: target.baseBody.race,
            targetAppearance: target.baseBody.description,
          }
        : {}),
      ...(target ? { targetBlock: target.stats.block } : {}),
      ...(target ? { targetHp: `${target.hp}/${target.stats.maxHp}` } : {}),
    }),
    messages: [],
    tools: [tools.damage, tools.record, tools.submit],
    handlers: {
      [tools.damage.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "计划已提交");
        }
        const targetActorName =
          typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
        const amount = Number(args.amount);
        if (!targetNames.includes(targetActorName) || !Number.isInteger(amount) || amount <= 0) {
          throw new GameError("invalid_action", "damage_target 参数无效");
        }
        operations.push({
          kind: "damage",
          targetActorName,
          amount,
          reason: typeof args.reason === "string" ? args.reason : "",
        });
        return `已记录对 ${targetActorName} 的 ${amount} 点补充伤害`;
      },
      [tools.record.function.name]: (args) => {
        if (submitted) {
          throw new GameError("invalid_action", "计划已提交");
        }
        const targetActorName =
          typeof args.targetActorName === "string" ? args.targetActorName.trim() : "";
        const experience = typeof args.experience === "string" ? args.experience.trim() : "";
        const witnessText = typeof args.witnessText === "string" ? args.witnessText.trim() : "";
        if (!targetNames.includes(targetActorName) || !experience || !witnessText) {
          throw new GameError("invalid_action", "record_effect 参数无效");
        }
        if (
          experience.length > MAX_AFFIX_EFFECT_LENGTH ||
          witnessText.length > MAX_AFFIX_EFFECT_LENGTH
        ) {
          throw new GameError(
            "invalid_action",
            `词缀后果不能超过 ${MAX_AFFIX_EFFECT_LENGTH} 个字符`,
          );
        }
        if (
          operations.filter((operation) => operation.kind === "effect").length >= MAX_AFFIX_EFFECTS
        ) {
          throw new GameError("invalid_action", `最多记录 ${MAX_AFFIX_EFFECTS} 条词缀后果`);
        }
        operations.push({ kind: "effect", targetActorName, experience, witnessText });
        return `已记录对 ${targetActorName} 的可见后果`;
      },
      [tools.submit.function.name]: () => {
        submitted = true;
        return "词缀补充效果已提交";
      },
    },
    terminalTools: [tools.submit],
    service,
    maxRounds: 2,
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
 * 约束：追加伤害必须对当事人可见，因此反馈同时写进出手者记忆。
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
        operation.targetActorName,
      );
      if (!targetRow) {
        continue;
      }
      if (operation.kind === "effect") {
        // 目标可能已经被默认效果打死：尸体照样会变，记忆必须写。
        await appendSelfObservation(
          tx,
          gameId,
          actorRow.stage.id,
          targetRow.id,
          operation.experience,
          { itemName: itemRow.name, targetActorId: targetRow.id },
          trace,
        );
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
