import { z } from "zod";

/**
 * 角色与道具共用的唯一属性结构。
 *
 * 六个字段都是恒定配置：可逐字段相加、可继承、可覆盖。当前生命是可变运行时
 * 状态而不是属性，所以不在 `Stats` 里，放在 `ActorState.hp` / `actors.hp`。
 * 新增属性只改 `STAT_KEYS`，类型自动跟着变。
 *
 * `Stats` 是属性容器，不是面板读数：一次攻击打多少、一次格挡挡多少，都在结算
 * 那一刻由属性换算成临时值（见 `gameplay/combat.ts`），用完即弃。
 *
 * 结算期的读法：`strength` 换算成角色的 `damage`，装备的 `damage` 加进来成为攻击力；
 * `block` 只取装备终值当格挡；`agility` 决定查看与窃取是否被察觉、窃取是否得手。
 * `wisdom`（智慧）目前没有任何读取点——写进内容也不会影响游戏。
 *
 * 这些读点与换算属玩法数值层（`gameplay/`），不是属性本身的性质：哪个字段影响什么
 * 由 `gameplay/rules.ts` 的开关决定，数据块只保证一份形状。
 *
 * 字段按所有者分两层：`maxHp` / `strength` / `wisdom` / `agility` 是角色拥有的源属性
 * （装备写它们是对穿戴者的加成），`damage` / `block` 是道具固有的终值——角色身上那
 * 两个字段只是结算期的顺时输出。分层与结算顺序见 `docs/attributes.md`。
 */

/** 角色拥有、由内容写进角色的字段。 */
const SOURCE_STAT_KEYS = ["maxHp", "strength", "wisdom", "agility"] as const;

/** 道具固有的终值；角色身上只是结算期的顺时输出。 */
const FINAL_STAT_KEYS = ["damage", "block"] as const;

/** 属性的展示顺序；渲染 prompt 等只读用途直接复用，避免再抄一份字段列表。 */
const STAT_KEYS = [...SOURCE_STAT_KEYS, ...FINAL_STAT_KEYS] as const;

export { FINAL_STAT_KEYS, SOURCE_STAT_KEYS, STAT_KEYS };

export type StatKey = (typeof STAT_KEYS)[number];
export type SourceStatKey = (typeof SOURCE_STAT_KEYS)[number];
export type FinalStatKey = (typeof FINAL_STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

/**
 * 面向 agent 的文本里属性的中文名。
 *
 * 字段名与中文的对应只在这里维护一次：渲染一律用中文，工具契约里再说明字段名，
 * 两处不会各写一套、也不会出现「damage：」这种半中半英的行。
 */
export const STAT_LABELS: Record<StatKey, string> = {
  maxHp: "最大生命",
  strength: "力量",
  wisdom: "智慧",
  agility: "敏捷",
  damage: "伤害",
  block: "格挡",
};

/**
 * 同一条 `STAT_KEYS` 派生的内容校验形状：未写出的字段补 0，运行时总是完整 `Stats`。
 * 新增属性只改 `STAT_KEYS`，校验不会漏在外面。
 */
export const statsSchema = z.object({
  maxHp: z.number().default(0),
  strength: z.number().default(0),
  wisdom: z.number().default(0),
  agility: z.number().default(0),
  damage: z.number().default(0),
  block: z.number().default(0),
} satisfies Record<StatKey, z.ZodDefault<z.ZodNumber>>);

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

/** 取一份属性里的源属性，终值清零。 */
export function sourcesOf(stats: Stats): Stats {
  return {
    ...EMPTY_STATS,
    maxHp: stats.maxHp,
    strength: stats.strength,
    wisdom: stats.wisdom,
    agility: stats.agility,
  };
}

/** 取一份属性里的终值，源属性清零。 */
export function finalsOf(stats: Stats): Stats {
  return { ...EMPTY_STATS, damage: stats.damage, block: stats.block };
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
