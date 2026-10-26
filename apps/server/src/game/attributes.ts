/**
 * 角色与物品共用的唯一属性结构。
 *
 * 六个字段都是恒定配置：可逐字段相加、可继承、可覆盖。当前生命是可变运行时
 * 状态而不是属性，所以不在 `Stats` 里，放在 `ActorState.hp` / `actors.hp`。
 * 新增属性只改 `STAT_KEYS`，类型自动跟着变。
 *
 * 结算只读 `damage` 与 `block`；`strength` / `wisdom` / `agility` 是标准角色属性
 * （力量 / 智慧 / 敏捷），留在结构里但没有任何代码读取——写进内容也不会影响游戏。
 */
const STAT_KEYS = ["maxHp", "strength", "wisdom", "agility", "damage", "block"] as const;

/** 属性的展示顺序；渲染 prompt 等只读用途直接复用，避免再抄一份字段列表。 */
export { STAT_KEYS };

type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

/** 全 0 属性；归一化与聚合的起点。 */
export const EMPTY_STATS: Stats = {
  maxHp: 0,
  strength: 0,
  wisdom: 0,
  agility: 0,
  damage: 0,
  block: 0,
};

/**
 * 归一化成完整属性：内容可能省略字段，旧数据可能残留已移出的字段（如 hp）。
 * 显式逐字段读取，因此多余字段会被丢掉，运行时 `Stats` 一定齐全。
 */
export function toStats(stats: Partial<Stats> | undefined): Stats {
  return {
    maxHp: stats?.maxHp ?? 0,
    strength: stats?.strength ?? 0,
    wisdom: stats?.wisdom ?? 0,
    agility: stats?.agility ?? 0,
    damage: stats?.damage ?? 0,
    block: stats?.block ?? 0,
  };
}

/** 逐字段相加：装备加成与临时修正都走这里，全局只有这一条加法规则。 */
export function addStats(...list: readonly (Partial<Stats> | undefined)[]): Stats {
  const total: Stats = { ...EMPTY_STATS };
  for (const stats of list) {
    const normalized = toStats(stats);
    for (const key of STAT_KEYS) {
      total[key] += normalized[key];
    }
  }
  return total;
}
