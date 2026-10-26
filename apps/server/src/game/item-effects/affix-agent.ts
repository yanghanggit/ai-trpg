import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import type { ToolDefinition } from "../../llm/types";
import type { Executor } from "../apply/types";
import { STAT_KEYS, type Stats } from "../attributes";
import { GameError } from "../errors";
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

/** 执行一个物品的补充 affix agent；默认效果已提交后调用。 */
export async function runAffixEffect(
  db: Database,
  gameId: string,
  request: AffixRequest,
  service: ChatCompletionService,
): Promise<void> {
  const state = await getGameState(db, gameId);
  if (state.game.status !== "active") {
    return;
  }
  const actor = state.world.stages
    .flatMap((stage) => stage.actors)
    .find((candidate) => candidate.id === request.actorId);
  const stage = state.world.stages.find((candidate) =>
    candidate.actors.some((entry) => entry.id === request.actorId),
  );
  const item = actor?.items.find((candidate) => candidate.id === request.itemId);
  if (!actor || !stage || !item || item.affixes.length === 0) {
    return;
  }
  const target = request.targetActorId
    ? state.world.stages
        .flatMap((candidate) => candidate.actors)
        .find((candidate) => candidate.id === request.targetActorId)
    : undefined;
  const targetNames = stage.actors.map((candidate) => candidate.name);
  if (targetNames.length === 0) {
    return;
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
  });

  if (!loop.success || operations.length === 0) {
    return;
  }
  // 落账是独立的一次短事务：词缀的 LLM 调用在事务外，重新读取参与结算的行，
  // 并用游戏行锁把同一局的写入串行化。
  await db.transaction(async (tx) => {
    const game = await lockGameRow(tx, gameId);
    if (game?.status !== "active") {
      return;
    }
    const world = await loadWorldByGame(tx, gameId);
    if (!world) {
      return;
    }
    const actorRow = await loadActorWithStage(tx, request.actorId, world.id);
    const itemRow = await loadActorItem(tx, request.actorId, request.itemId);
    if (!actorRow || !itemRow) {
      return;
    }
    const now = new Date();
    for (const operation of operations) {
      const targetRow = await loadActorByNameInStage(
        tx,
        actorRow.stage.id,
        operation.targetActorName,
      );
      if (!targetRow) {
        continue;
      }
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
        },
        operation.amount,
      );
    }
  });
}
