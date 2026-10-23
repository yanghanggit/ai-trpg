import { eq } from "drizzle-orm";
import { games } from "../db/schema";
import { appendPublicMessage } from "./apply/messages";
import type { ActorRow, Executor, ItemRow, StageRow } from "./apply/types";
import { appendStageEvent } from "./observations";
import type { ItemUseEffect } from "./types";

/** 物品效果执行所需的已解析上下文；效果本身不负责查找目标。 */
export type ItemEffectContext = {
  executor: Executor;
  gameId: string;
  stage: StageRow;
  actor: Pick<ActorRow, "id" | "name">;
  item: Pick<ItemRow, "name">;
  target?: ActorRow;
  targetStage?: StageRow;
  now: Date;
};

export type ItemEffectOutcome = {
  /** 追加到 use 行动结果里的内容文案。 */
  results: string[];
  completed: boolean;
};

/** 把内容提供的占位符替换成当前上下文中的显示名。 */
function formatEffectText(template: string, context: ItemEffectContext): string {
  const targetName = context.target?.name ?? context.targetStage?.name ?? "目标";
  return template
    .replaceAll("{actor}", context.actor.name)
    .replaceAll("{item}", context.item.name)
    .replaceAll("{target}", targetName);
}

/** 执行物品的声明式效果；目前只有 complete_game。 */
export async function applyItemUseEffects(
  context: ItemEffectContext,
  effects: readonly ItemUseEffect[],
): Promise<ItemEffectOutcome> {
  const results: string[] = [];
  let completed = false;

  for (const effect of effects) {
    switch (effect.type) {
      case "complete_game": {
        completed = await completeGame(context, effect);
        results.push(formatEffectText(effect.result ?? effect.message, context));
        break;
      }
      default: {
        throw new Error(`未知物品效果: ${String((effect as { type: string }).type)}`);
      }
    }
  }

  return { results, completed };
}

/** 写通关结果：游戏状态、公共消息与场景事件，文案全部来自效果。 */
async function completeGame(
  context: ItemEffectContext,
  effect: Extract<ItemUseEffect, { type: "complete_game" }>,
): Promise<boolean> {
  const { executor, gameId, stage, actor, item, target, targetStage, now } = context;
  await executor
    .update(games)
    .set({ status: "completed", updatedAt: now })
    .where(eq(games.id, gameId));

  const content = formatEffectText(effect.message, context);
  await appendPublicMessage(executor, gameId, null, {
    kind: "game_completed",
    stageId: stage.id,
    visibility: "stage",
    content,
  });
  await appendStageEvent(executor, gameId, stage.id, `# 场景事件\n${content}`, {
    eventKind: "game_completed",
  });
  console.error(
    `[game] completed: game=${gameId} actor=${actor.name} item=${item.name} target=${
      target?.name ?? targetStage?.name ?? "unknown"
    }`,
  );
  return true;
}
