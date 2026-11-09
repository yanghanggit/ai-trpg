import { resolveEquippedStats } from "../apply/queries";
import type { ActorRow, Executor } from "../apply/types";
import { addStats, type Stats } from "../attributes";

/**
 * 攻击方伤害：自身 `damage` + 本次物品 `damage`。
 *
 * 只读 `damage`，其余属性不参与；物品可以省略（空手）。
 */
export function attackDamage(attackerStats: Stats, itemStats?: Stats): number {
  return addStats(attackerStats, itemStats).damage;
}

/** 目标的防御：自身 block + 已穿戴物品 block，结算时现读。 */
export async function defenderBlock(executor: Executor, target: ActorRow): Promise<number> {
  const defender = addStats(target.stats, await resolveEquippedStats(executor, target));
  return defender.block;
}

/**
 * 固定战斗公式：max(0, 攻击方 damage - 目标 block)。
 *
 * 这是整份代码里唯一的减伤点：一个动作只能调用一次，
 * 多个静态词缀必须先把伤害求和再传进来。
 */
export async function mitigatedAttackDamage(
  executor: Executor,
  attackerStats: Stats,
  itemStats: Stats | undefined,
  target: ActorRow,
): Promise<number> {
  return Math.max(
    0,
    attackDamage(attackerStats, itemStats) - (await defenderBlock(executor, target)),
  );
}
