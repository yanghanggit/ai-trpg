/** 属性的作用域：角色根属性，或物品的战斗属性。 */
export type AttributeScope = "actor" | "item";

export type AttributeDefinition = {
  label: string;
  scope: AttributeScope;
  description: string;
};

/**
 * 本系统 TRPG 能承载的全部数值属性。
 *
 * 新属性先在这里登记，再决定作用域；所有计算只通过这里登记的 key 进行，
 * 不在动作代码里临时发明字段。
 */
export const ATTRIBUTE_DEFINITIONS = {
  hp: { label: "生命", scope: "actor", description: "当前生命；降到 0 时角色死亡" },
  maxHp: { label: "生命上限", scope: "actor", description: "生命上限" },
  attack: { label: "攻击", scope: "actor", description: "攻击的基础伤害" },
  defense: { label: "防御", scope: "actor", description: "受到攻击时减免的伤害" },
  speed: { label: "速度", scope: "actor", description: "行动顺序与追逐判定" },
  damage: { label: "伤害", scope: "item", description: "武器参与攻击时增加的伤害" },
  block: { label: "格挡", scope: "item", description: "装备提供的减免；当前只存储" },
} as const satisfies Record<string, AttributeDefinition>;

export type AttributeKey = keyof typeof ATTRIBUTE_DEFINITIONS;
export type Attributes = Partial<Record<AttributeKey, number>>;

/** actor 的根属性必须齐全。 */
export const ACTOR_ATTRIBUTE_KEYS = ["hp", "maxHp", "attack", "defense", "speed"] as const;
export type ActorAttributeKey = (typeof ACTOR_ATTRIBUTE_KEYS)[number];
export type ActorStats = Record<ActorAttributeKey, number>;

/** 物品只携带战斗相关属性。 */
export const ITEM_ATTRIBUTE_KEYS = ["damage", "block"] as const;
export type ItemAttributeKey = (typeof ITEM_ATTRIBUTE_KEYS)[number];
export type ItemStats = Partial<Record<ItemAttributeKey, number>>;

/** 读取属性；缺省为 0，避免每个调用点重复写 `?? 0`。 */
export function attribute(stats: Attributes | undefined, key: AttributeKey): number {
  return stats?.[key] ?? 0;
}

/** 汇总多件物品的同一属性；武器伤害等计算统一走这里。 */
export function sumAttribute(
  statsList: readonly (Attributes | undefined)[],
  key: AttributeKey,
): number {
  return statsList.reduce((total, stats) => total + attribute(stats, key), 0);
}
