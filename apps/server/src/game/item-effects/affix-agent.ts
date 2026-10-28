import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import type { TraceContext } from "../../debug/trace";
import { agentLoop } from "../../llm/agent-loop";
import type { LlmLogger } from "../../llm/logger";
import type { ChatCompletionService } from "../../llm/protocol";
import type { ToolDefinition } from "../../llm/types";
import { isAlive } from "../apply/queries";
import type { Executor } from "../apply/types";
import { STAT_KEYS, type Stats } from "../attributes";
import { MEMORY_KINDS } from "../constants";
import { GameError } from "../errors";
import { runIncrementalPhase } from "../incremental";
import { appendMemoryMessages, loadAgentMemory } from "../memory";
import { loadActorByNameInStage, loadActorWithStage } from "../persistence/actors";
import { lockGameRow } from "../persistence/games";
import { loadActorItem } from "../persistence/items";
import { loadWorldByGame } from "../persistence/worlds";
import { getGameState } from "../service";
import { applyDamage } from "./damage";
import type { AffixRequest } from "./types";

type AffixOperation = {
  targetActorName: string;
  amount: number;
  reason: string;
};

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
 * 工具清单由 `buildTools()` 结果传入，新增工具时提示词自动跟着变。
 */
function buildAffixPrompt(input: {
  actorName: string;
  actorStats: Stats;
  itemName: string;
  itemDescription: string;
  itemStats: Stats;
  affixes: readonly string[];
  defaultFeedback: string;
  toolNames: readonly string[];
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

默认效果已结算（见下），但它不代表词缀已经生效。词缀是否生效、生效到什么程度，由你判定并用工具落账。

## 默认效果
${input.defaultFeedback}

## 结算对象
场景：${input.stageName}
持有者：${input.actorName}（${statsText(input.actorStats)}）
物品：${input.itemName}（${statsText(input.itemStats)}）
${input.itemDescription}
词缀：
${input.affixes.map((affix) => `- ${affix}`).join("\n")}
目标：${input.targetName ?? "无角色目标"}
${targetFacts.join("\n")}

## 规则

1. 词缀是一句自然语言规则，不是关键词匹配：先读它指定的对象、条件、效果与比例，再用目标的名字、种族、外观与当前状态判定条件是否成立。描述性特征按语义判定，同义或上下位表述都算成立，字面不同不构成排除。
2. 先判定后执行：条件成立才执行词缀描述的效果；条件不成立、或当前工具无法表达该效果时，什么都不做，只结束任务；也不要顺手附加词缀以外的后果。
3. 词缀引用的数值取物品自身的字段（见上）；比例按词缀写的方式换算，与默认效果造成的结果无关。词缀对程度留有余地（如“越……越……”）时，可依据特征强弱小幅增减并说明依据。
4. 每次工具调用都要写清依据，可多次调用；最后用 ${input.terminalToolName} 结束，即使什么都没做。

## 工具
${input.toolNames.join("、")}（终止：${input.terminalToolName}）`;
}

function buildTools(targetNames: readonly string[]): {
  damage: ToolDefinition;
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
      toolNames: [tools.damage.function.name, tools.submit.function.name],
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
    tools: [tools.damage, tools.submit],
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
          targetActorName,
          amount,
          reason: typeof args.reason === "string" ? args.reason : "",
        });
        return `已记录对 ${targetActorName} 的 ${amount} 点补充伤害`;
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
): Promise<number> {
  return db.transaction(async (tx) => {
    const game = await lockGameRow(tx, gameId);
    if (game?.status !== "active") {
      return 0;
    }
    const world = await loadWorldByGame(tx, gameId);
    if (!world) {
      return 0;
    }
    const actorRow = await loadActorWithStage(tx, request.actorId, world.id);
    const itemRow = await loadActorItem(tx, request.actorId, request.itemId);
    if (!actorRow || !itemRow) {
      return 0;
    }
    const now = new Date();
    const feedbacks: string[] = [];
    for (const operation of operations) {
      const targetRow = await loadActorByNameInStage(
        tx,
        actorRow.stage.id,
        operation.targetActorName,
      );
      if (!targetRow || !isAlive(targetRow)) {
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
    return feedbacks.length;
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
  logger?: LlmLogger,
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
      if (applied === 0) {
        return {
          kind: "noop",
          reason: "落账时目标已倒下或已离开场景",
          ...head,
          detail: { ...subject, operations: evaluation.operations.length },
        };
      }
      return {
        kind: "applied",
        ...head,
        detail: { ...subject, operations: evaluation.operations.length, applied },
      };
    },
  );
}
