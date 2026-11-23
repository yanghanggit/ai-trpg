import { EMPTY_STATS, type Stats, toStats } from "./attributes";

/**
 * 状态效果：挂在角色身上的静态属性调整。
 *
 * 角色与道具是两个宿主：词缀按动作触发、产出一段结算；状态效果在场即生效，没有触发，
 * 只改现值。两者因此不共用类型——共用的是属性块与那条加法规则。
 *
 * v1 只有开局注入：内容写一次，建局时物化进 actor 行；运行时没有施加 / 移除，也没有
 * 时长。时长依赖「一局怎么计时」，那个问题还没定义，所以这里不占位。
 *
 * 效果只做加法、只调有结算读点的源属性（`EFFECT_STAT_KEYS`）。终值属于道具，智慧与
 * 生命上限没有读点；写进来就是「写了却不生效」的静默错，内容校验直接拒绝。
 */
export type StatusEffect = {
  /** 角色内唯一 key：去重靠它，将来的移除也靠它；改 `name` 不影响它。 */
  key: string;
  name: string;
  /** 给模型读的表现与规则文本；v1 不解析。 */
  content: string;
  /** 属性调整；已归一化为完整 `Stats`，只有 `EFFECT_STAT_KEYS` 会是非 0 值。 */
  stats: Stats;
};

/** 内容层形态：`stats` 可以省略字段，未写出的按 0 补齐。 */
export type StatusEffectInput = Omit<StatusEffect, "stats"> & { stats?: Partial<Stats> };

/** 效果的中文名；面板与提示词共用这一份。 */
export const STATUS_EFFECT_LABEL = "状态效果";

/** v1 允许调整的属性：只放行有结算读点的源属性。 */
export const EFFECT_STAT_KEYS = ["strength", "agility"] as const;

/** 归一化：缺字段补 0、多余字段丢弃，运行时总是完整 `StatusEffect`。 */
export function toStatusEffect(input: StatusEffectInput): StatusEffect {
  return {
    key: input.key,
    name: input.name,
    content: input.content,
    stats: toStats(input.stats),
  };
}

/**
 * 全部效果贡献的源属性：逐条只取 `EFFECT_STAT_KEYS`。
 *
 * 白名单而不是 `addStats` 的整块相加，是最后一道兜底：即使内容校验被绕过、终值或
 * 智慧混进了 `stats`，也不会从效果这里流出——角色不存终值这条口径不靠调用方自觉。
 */
export function statusEffectSources(effects: readonly StatusEffect[]): Stats {
  const total: Stats = { ...EMPTY_STATS };
  for (const effect of effects) {
    const stats = toStats(effect.stats);
    for (const key of EFFECT_STAT_KEYS) {
      total[key] += stats[key];
    }
  }
  return total;
}

/** 单条效果的展示文本；面板与提示词共用。 */
export function describeStatusEffect(effect: StatusEffect): string {
  return `[${effect.name}]${effect.content}`;
}
