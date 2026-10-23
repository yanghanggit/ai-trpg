import { eq } from "drizzle-orm";
import { actors } from "../../db/schema";
import { appendPublicMessage, bumpGameVersion, itemListText } from "../apply/messages";
import { attribute } from "../attributes";
import { appendAttackObservations, appendStageEvent } from "../observations";
import type { ItemEffectContext, ItemEffectHandler } from "./types";

/** 固定战斗公式：max(0, actor.attack + item.damage - target.defense)。 */
export function calculateFixedDamage(context: ItemEffectContext): number {
  const { actorRow, item, target } = context;
  if (!target) {
    throw new Error("damage effect 需要角色目标");
  }
  return Math.max(
    0,
    actorRow.actor.stats.attack + attribute(item?.stats, "damage") - target.stats.defense,
  );
}

/** 把已经算好的伤害写入数据库、消息与观察。 */
export async function applyDamage(context: ItemEffectContext, damage: number): Promise<string> {
  const { executor, gameId, actorRow, stage, item, target, actionKind, now } = context;
  if (!target) {
    throw new Error("damage effect 需要角色目标");
  }
  // 默认 effect 与 affix 可能连续结算；伤害前重新读取目标当前 HP，避免旧快照覆盖。
  const [current] = await executor.select().from(actors).where(eq(actors.id, target.id)).limit(1);
  if (!current) {
    throw new Error(`目标不存在: ${target.name}`);
  }
  if (current.status === "dead") {
    return `# 行动结果\n${target.name}已经倒下。`;
  }
  const currentStats = current.stats;
  const remainingHp = Math.max(0, currentStats.hp - damage);
  const status = remainingHp <= 0 ? "dead" : "alive";

  await executor
    .update(actors)
    .set({ stats: { ...currentStats, hp: remainingHp }, status, updatedAt: now })
    .where(eq(actors.id, target.id));
  await bumpGameVersion(executor, gameId, now);

  const itemText = item ? itemListText([item]) : "";
  const outcome =
    status === "dead"
      ? `；${target.name}倒下了。`
      : `；${target.name}剩余 HP ${remainingHp}/${currentStats.maxHp}。`;
  const actionText =
    actionKind === "attack" ? `使用攻击${itemText}` : `使用${item?.name ?? "空手"}`;
  const content = `${actorRow.actor.name}对${target.name}${actionText}，造成${damage}点伤害${outcome}`;
  await appendPublicMessage(executor, gameId, actorRow.actor.id, {
    kind: actionKind,
    stageId: stage.id,
    targetActorId: target.id,
    visibility: "stage",
    content,
  });
  await appendAttackObservations(
    executor,
    gameId,
    stage,
    { id: actorRow.actor.id, name: actorRow.actor.name },
    { id: target.id, name: target.name, maxHp: currentStats.maxHp },
    "stage",
    item ? [item] : [],
    damage,
    remainingHp,
    status,
  );
  await appendStageEvent(executor, gameId, stage.id, `# 场景事件\n${content}`, {
    eventKind: actionKind,
    targetActorId: target.id,
  });
  const feedback =
    actionKind === "attack"
      ? `你使用攻击${itemText}对${target.name}，造成${damage}点伤害；`
      : `你对${target.name}使用${item?.name ?? "空手"}，造成${damage}点伤害；`;
  return `# 行动结果\n${feedback}${
    status === "dead"
      ? `${target.name}倒下了`
      : `${target.name}剩余 HP ${remainingHp}/${currentStats.maxHp}`
  }。`;
}

/** 固定伤害 handler。 */
export const applyDamageEffect: ItemEffectHandler = async (context) => {
  return applyDamage(context, calculateFixedDamage(context));
};
