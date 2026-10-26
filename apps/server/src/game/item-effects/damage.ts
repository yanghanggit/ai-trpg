import { appendPublicMessage, bumpGameVersion, itemListText } from "../apply/messages";
import { resolveEquippedStats } from "../apply/queries";
import { addStats } from "../attributes";
import { completeGame } from "../end-game";
import { appendAttackObservations, appendStageEvent } from "../observations";
import { damageActor } from "../persistence/actors";
import type { ItemEffectContext, ItemEffectHandler } from "./types";

/**
 * 固定战斗公式：max(0, 攻击方 damage - 目标 block)。
 *
 * 只读 `damage` 与 `block` 两项：`strength` / `wisdom` / `agility` 字段仍保留在 `Stats` 里，
 * 但不参与任何结算。双方都走 addStats 一条加法规则——攻击方是自身 stats + 本次物品 stats，
 * 目标是自身 stats + 已穿戴物品 stats；target 的装备加成在结算时现读，避免旧快照。
 */
export async function calculateFixedDamage(context: ItemEffectContext): Promise<number> {
  const { executor, actorRow, item, target } = context;
  if (!target) {
    throw new Error("damage effect 需要角色目标");
  }
  const attacker = addStats(actorRow.actor.stats, item?.stats);
  const defender = addStats(target.stats, await resolveEquippedStats(executor, target));
  return Math.max(0, attacker.damage - defender.block);
}

/** 把已经算好的伤害写入数据库、消息与观察。 */
export async function applyDamage(context: ItemEffectContext, damage: number): Promise<string> {
  const { executor, gameId, actorRow, stage, item, target, actionKind, now } = context;
  if (!target) {
    throw new Error("damage effect 需要角色目标");
  }
  // 默认效果与 affix 会连续结算同一个目标：扣血走带行锁的读-改-写，不拿旧快照覆盖。
  // 这里只写 hp，是否"死亡"完全由 hp 派生，不由攻击方断定。
  const hit = await damageActor(executor, target.id, damage, now);
  if (hit.status === "missing") {
    throw new Error(`目标不存在: ${target.name}`);
  }
  const current = hit.row;
  if (hit.status === "already-dead") {
    return `# 行动结果\n${target.name}已经倒下。`;
  }
  const remainingHp = hit.remainingHp;
  await bumpGameVersion(executor, gameId, now);

  const itemText = item ? itemListText([item]) : "";
  const outcome =
    remainingHp <= 0
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
  );
  await appendStageEvent(executor, gameId, stage.id, `# 场景事件\n${content}`, {
    eventKind: actionKind,
    targetActorId: target.id,
  });
  if (remainingHp <= 0 && current.isDefaultPlayer) {
    await completeGame(executor, gameId, `${target.name}倒下了。故事就此结束。`, {
      now,
      stageId: stage.id,
    });
  }
  // 出手者只知道这一下打得多重、对方有没有倒下；对方剩余生命只写进公共消息（上帝视角）
  // 与受害者自己，不进出手者的记忆。
  const feedback =
    actionKind === "attack"
      ? `你使用攻击${itemText}对${target.name}，造成${damage}点伤害`
      : `你对${target.name}使用${item?.name ?? "空手"}，造成${damage}点伤害`;
  return `# 行动结果\n${feedback}${remainingHp <= 0 ? `；${target.name}倒下了` : ""}。`;
}

/** 固定伤害 handler。 */
export const applyDamageEffect: ItemEffectHandler = async (context) => {
  return applyDamage(context, await calculateFixedDamage(context));
};
