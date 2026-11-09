import { resolveEquippedStats } from "../apply/queries";
import type { ActorRow, Executor } from "../apply/types";
import { addStats, type Stats } from "../attributes";

/**
 * 属性 → 战斗数值的换算，只在结算期发生一次。
 *
 * `Stats` 是属性容器，不是面板读数：一次攻击能打多少、一次格挡能挡多少，
 * 都是结算那一刻由属性算出来的临时值，用完即弃——不写回角色，也不缓存。
 * 角色身上的 `damage` / `block` 因此不是「最终数值」，只是换算式的一项输入；
 * 现在两处换算都取相等，将来要加曲线、系数或第二属性，只改下面几个函数。
 */
export function attackPower(stats: Stats): number {
  return stats.damage + strengthToDamage(stats.strength);
}

/** 力量 → 伤害的换算；本期 1:1。 */
export function strengthToDamage(strength: number): number {
  return strength;
}

/** 格挡的换算；本期直接取 `block`。 */
export function guardPower(stats: Stats): number {
  return stats.block;
}

/**
 * 挥击与横扫的攻击力：自身与本次物品的属性相加后换算一次。
 *
 * 肉搏不走这里（见 `unarmedDamage`）：空手怎么打由内容决定，跟武器不共用一个入口。
 */
export function weaponAttackPower(attackerStats: Stats, itemStats?: Stats): number {
  return attackPower(addStats(attackerStats, itemStats));
}

/** 肉搏的攻击力：本期只读自身 `damage`。 */
export function unarmedDamage(stats: Stats): number {
  return stats.damage;
}

/** 目标的防御：自身与已穿戴物品的属性相加后换算成格挡。 */
export async function defenderBlock(executor: Executor, target: ActorRow): Promise<number> {
  const defender = addStats(target.stats, await resolveEquippedStats(executor, target));
  return guardPower(defender);
}

/**
 * 固定战斗公式：max(0, 攻击力 - 目标格挡)。
 *
 * 这是整份代码里唯一的减伤点：一个动作只能调用一次，
 * 多个静态词缀必须先把伤害求和再传进来。
 */
export async function mitigatedDamage(
  executor: Executor,
  attack: number,
  target: ActorRow,
): Promise<number> {
  return Math.max(0, attack - (await defenderBlock(executor, target)));
}
