import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, games, items, stages, worlds } from "../../db/schema";
import { agentLoop } from "../../llm/agent-loop";
import type { ChatCompletionService } from "../../llm/protocol";
import type { ToolDefinition } from "../../llm/types";
import type { Executor } from "../apply/types";
import { addStats } from "../attributes";
import { GameError } from "../errors";
import { getGameState } from "../service";
import { applyDamage } from "./damage";
import type { AffixRequest } from "./types";

type AffixOperation = {
  targetActorName: string;
  amount: number;
  reason: string;
};

function buildObservation(input: {
  actorName: string;
  itemName: string;
  itemDescription: string;
  itemDamage: number;
  affixes: readonly string[];
  defaultFeedback: string;
  actorDamage: number;
  targetName?: string;
  targetRace?: string;
  targetHp?: string;
  targetBlock?: number;
  stageName: string;
}): string {
  return `# 物品词缀补充效果

默认效果已经执行。你需要根据词缀，决定是否以及如何追加效果。

## 默认效果结果
${input.defaultFeedback}

## 场景
${input.stageName}

## 持有者
${input.actorName}
damage：${input.actorDamage}

## 物品
${input.itemName}
基础 damage：${input.itemDamage}
${input.itemDescription}

词缀：
${input.affixes.map((affix) => `- ${affix}`).join("\n")}

## 目标
${input.targetName ?? "无角色目标"}
${input.targetRace ? `种族：${input.targetRace}` : ""}
${input.targetBlock !== undefined ? `block：${input.targetBlock}` : ""}
${input.targetHp ? `HP：${input.targetHp}` : ""}

## 规则

- 默认效果已经执行，上面的“默认效果结果”只是它造成的结果。
- 词缀中的 damage 指物品的“基础 damage”，不是默认效果造成的伤害。
- 只有需要追加效果时才调用工具。可以调用 damage_target 追加伤害，可以多次调用；完成后调用 submit_affix。`;
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
        description: "对场景中的一个角色追加伤害；amount 是本次补充伤害，不是最终总伤害。",
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
              description: "触发该补充效果的理由",
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
        description: "提交本轮词缀补充效果并结束。",
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
    inputMessage: buildObservation({
      actorName: actor.name,
      itemName: item.name,
      itemDescription: item.description,
      itemDamage: item.stats.damage,
      affixes: item.affixes,
      defaultFeedback: request.defaultFeedback,
      actorDamage: addStats(actor.stats, item.stats).damage,
      stageName: stage.name,
      ...(target ? { targetName: target.name, targetRace: target.baseBody.race } : {}),
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
  await db.transaction(async (tx) => {
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).limit(1).for("update");
    if (game?.status !== "active") {
      return;
    }
    const [world] = await tx.select().from(worlds).where(eq(worlds.gameId, gameId)).limit(1);
    if (!world) {
      return;
    }
    const [actorRow] = await tx
      .select({ actor: actors, stage: stages })
      .from(actors)
      .innerJoin(stages, eq(actors.stageId, stages.id))
      .where(and(eq(actors.id, request.actorId), eq(stages.worldId, world.id)))
      .limit(1);
    const [itemRow] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, request.itemId), eq(items.actorId, request.actorId)))
      .limit(1);
    if (!actorRow || !itemRow) {
      return;
    }
    const now = new Date();
    for (const operation of operations) {
      const [targetRow] = await tx
        .select()
        .from(actors)
        .where(
          and(eq(actors.stageId, actorRow.stage.id), eq(actors.name, operation.targetActorName)),
        )
        .limit(1);
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
