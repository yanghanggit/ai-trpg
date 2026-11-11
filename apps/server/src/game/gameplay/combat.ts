import type { Stats } from "../kernel/attributes";
import { GAMEPLAY_RULES, type GameplayRules } from "./rules";

/**
 * 属性 → 战斗数值的换算，只在结算期发生一次。
 *
 * 输入是角色的**源属性**（本体加装备加成）与**装备终值**（武器伤害、护甲格挡），
 * 输出是那一刻的攻击力与格挡；用完即弃，不写回角色，也不缓存。角色的 `damage` /
 * `block` 不是存储值，而是这里的顺时结果——分层见 `docs/attributes.md`。
 *
 * 这一层是纯函数：不读库、不调模型、不带随机。行由 `lookup` 读齐后传进来。
 */

/** 力量 → 伤害的换算；本期 1:1，可被 `GAMEPLAY_RULES` 关掉。 */
export function strengthToDamage(strength: number, rules: GameplayRules = GAMEPLAY_RULES): number {
  return rules.strengthAddsToAttack ? strength : 0;
}

/** 角色顺时的 `damage`：只由源属性导出，不落库。 */
export function actorDamage(sources: Stats, rules: GameplayRules = GAMEPLAY_RULES): number {
  return strengthToDamage(sources.strength, rules);
}

/**
 * 攻击力：角色顺时的 `damage` 加上装备终值里的 `damage`。
 *
 * 挥击、横扫与词缀的 `{{attack}}` 都走这里；肉搏见 `unarmedAttackPower`。
 */
export function attackPower(
  sources: Stats,
  equipmentFinals: Stats,
  rules: GameplayRules = GAMEPLAY_RULES,
): number {
  return actorDamage(sources, rules) + equipmentFinals.damage;
}

/**
 * 格挡：只取装备终值里的 `block`。
 *
 * 角色自身的源属性不产出格挡——防御完全来自穿戴；这是开发期的取舍，换别的来源
 * 只改这个函数。
 */
export function guardPower(equipmentFinals: Stats): number {
  return equipmentFinals.block;
}

/** 肉搏的攻击力：只读源属性算出的 `damage`，不吃装备终值。 */
export function unarmedAttackPower(sources: Stats, rules: GameplayRules = GAMEPLAY_RULES): number {
  return actorDamage(sources, rules);
}

/**
 * 固定战斗公式：max(0, 攻击力 - 格挡)。
 *
 * 这是整份代码里唯一的减伤点：一个动作只能调用一次，
 * 多个静态词缀必须先把伤害求和再传进来。
 */
export function mitigatedDamage(attack: number, block: number): number {
  return Math.max(0, attack - block);
}
