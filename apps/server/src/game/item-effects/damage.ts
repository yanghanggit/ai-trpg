import { eq } from "drizzle-orm";
import { actors } from "../../db/schema";
import { appendPublicMessage, bumpGameVersion, itemListText } from "../apply/messages";
import { resolveEquippedStats } from "../apply/queries";
import { addStats } from "../attributes";
import { completeGame } from "../end-game";
import { appendAttackObservations, appendStageEvent } from "../observations";
import type { ItemEffectContext, ItemEffectHandler } from "./types";

/**
 * 固定战斗公式：max(0, 攻击方 attack + 物品 damage - (目标 defense + 目标装备总 block))。
 *
 * 属性只走 addStats 一条加法规则；目标的装备加成在结算时现读，避免旧快照。
 */
export async function calculateFixedDamage(context: ItemEffectContext): Promise<number> {
  const { executor, actorRow, item, target } = context;
  if (!target) {
    throw new Error("damage effect 需要角色目标");
  }
  const attacker = addStats(actorRow.actor.stats, item?.stats);
  const defender = await resolveEquippedStats(executor, target);
  return Math.max(0, attacker.attack + attacker.damage - target.stats.defense - defender.block);
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
  const remainingHp = Math.max(0, current.hp - damage);
  const status = remainingHp <= 0 ? "dead" : "alive";

  await executor
    .update(actors)
    .set({ hp: remainingHp, status, updatedAt: now })
    .where(eq(actors.id, target.id));
  await bumpGameVersion(executor, gameId, now);

  const itemText = item ? itemListText([item]) : "";
  const outcome =
    status === "dead"
      ? `；${target.name}倒下了。`
      : `；${target.name}剩余 HP ${remainingHp}/${current.stats.maxHp}。`;
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
    { id: target.id, name: target.name, maxHp: current.stats.maxHp },
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
  if (status === "dead" && current.isDefaultPlayer) {
    await completeGame(executor, gameId, `${target.name}倒下了。故事就此结束。`, {
      now,
      stageId: stage.id,
    });
  }
  const feedback =
    actionKind === "attack"
      ? `你使用攻击${itemText}对${target.name}，造成${damage}点伤害；`
      : `你对${target.name}使用${item?.name ?? "空手"}，造成${damage}点伤害；`;
  return `# 行动结果\n${feedback}${
    status === "dead"
      ? `${target.name}倒下了`
      : `${target.name}剩余 HP ${remainingHp}/${current.stats.maxHp}`
  }。`;
}

/** 固定伤害 handler。 */
export const applyDamageEffect: ItemEffectHandler = async (context) => {
  return applyDamage(context, await calculateFixedDamage(context));
};
