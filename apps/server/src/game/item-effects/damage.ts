import { eq } from "drizzle-orm";
import { actors } from "../../db/schema";
import { appendPublicMessage, bumpGameVersion, itemListText } from "../apply/messages";
import { attribute } from "../attributes";
import { appendAttackObservations, appendStageEvent } from "../observations";
import type { ItemEffectHandler } from "./types";

/** 战斗效果：伤害 = max(0, actor.attack + 物品 damage - 目标 defense)。 */
export const applyDamageEffect: ItemEffectHandler = async (context) => {
  const { executor, gameId, actorRow, stage, item, target, actionKind, now } = context;
  if (!target) {
    throw new Error("damage effect 需要角色目标");
  }
  const weaponDamage = attribute(item?.stats, "damage");
  const damage = Math.max(0, actorRow.actor.stats.attack + weaponDamage - target.stats.defense);
  const remainingHp = Math.max(0, target.stats.hp - damage);
  const status = remainingHp <= 0 ? "dead" : "alive";

  await executor
    .update(actors)
    .set({ stats: { ...target.stats, hp: remainingHp }, status, updatedAt: now })
    .where(eq(actors.id, target.id));
  await bumpGameVersion(executor, gameId, now);

  const itemText = item ? itemListText([item]) : "";
  const outcome =
    status === "dead"
      ? `；${target.name}倒下了。`
      : `；${target.name}剩余 HP ${remainingHp}/${target.stats.maxHp}。`;
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
    { id: target.id, name: target.name, maxHp: target.stats.maxHp },
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
      : `${target.name}剩余 HP ${remainingHp}/${target.stats.maxHp}`
  }。`;
};
