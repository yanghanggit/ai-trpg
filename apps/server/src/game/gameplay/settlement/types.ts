import type { Stats } from "../../kernel/attributes";
import type { AffixTriggers, HitAction } from "../../kernel/types";
import type { GameplayRules } from "../rules";

/**
 * 结算快照：一次动作里「瞬时脱离角色行」的只读值，生成后不回库、不写回。
 * `stats` 是属性块；生命、隐匿与死亡收尾标记也是规则会读的事实，一并进来。
 */

/** 角色在结算里的位置；不叫 attack/defense，治疗与反伤同样是这两个位置。 */
export type SettlementRole = "initiator" | "affected";

export type ActorSnapshot = Readonly<{
  role: SettlementRole;
  actorId: string;
  name: string;
  /** `damage` 是生成规则算好的攻击力，`block` 是格挡，`maxHp` 取角色行原值。 */
  stats: Stats;
  /** 当前生命；伤害截断、吸血与「血量差」类规则都读它。 */
  hp: number;
  /** 动作发生前的隐匿状态：快照必须在现身之前生成。 */
  concealed: boolean;
  /** 死亡是否已收尾；治疗只认这个标记，不认 `hp`。 */
  deathFinalized: boolean;
}>;

export type ItemSnapshot = Readonly<{
  name: string;
  stats: Stats;
  affixes: AffixTriggers;
}>;

/**
 * 该次结算解析出的完整规则配置，随快照进 trace。
 *
 * 结算只读这里、不读全局开关：一个快照加一份代码就能复现当时的结果。
 */
export type ResolvedRules = Readonly<{
  switches: Readonly<GameplayRules>;
  params: Readonly<{
    /** 吸血比例：实际伤害 × 该系数，向下取整；0 = 未启用。 */
    lifestealRate: number;
  }>;
}>;

export type SettlementInput = Readonly<{
  /** `brawl` 没有词缀触发，但走同一条结算：`intended` 取快照攻击力。 */
  action: HitAction;
  initiator: ActorSnapshot;
  affected?: ActorSnapshot;
  item?: ItemSnapshot;
  rules: ResolvedRules;
  /** 本次是否为伏击出手；静态词缀的 `ambush` 条件只读这个动作事实。 */
  ambush: boolean;
}>;

/** 一条写生命的效果；`hpDelta` 带符号，负 = 伤害，正 = 治疗。 */
export type HpEffect = Readonly<{
  kind: "damage" | "heal";
  role: SettlementRole;
  actorId: string;
  hpDelta: number;
}>;

/** 静态见证：文本与目标由落账层补齐后渲染。 */
export type SettlementWitness = Readonly<{
  affixName: string;
  template: string;
  visibility: "stage" | "target";
}>;

/** 一个目标的实际命中结果；供增量阶段按角色对齐。 */
export type SettlementHitResult = Readonly<{
  actorId: string;
  dealtDamage: number;
  targetDied: boolean;
}>;

export type SettlementOutcome = Readonly<{
  /** 是否出一次命中：触发恒命中，或声明了 damage op。 */
  hit: boolean;
  hasDamageOps: boolean;
  /** 减防前的伤害；`brawl` 是快照攻击力，武器动作是词缀求和。 */
  intended: number;
  /** 减一次 `affected.stats.block` 之后的伤害。 */
  mitigated: number;
  /** 按快照 `hp` 截断后的值；吸血与反伤从这里派生。 */
  actual: number;
  /** 快照时目标 `hp <= 0`：伤害空转，`effects` 里没有伤害项。 */
  affectedWasDead: boolean;
  /** 有序、逐条落账，不求和。 */
  effects: readonly HpEffect[];
  witnesses: readonly SettlementWitness[];
  /** 逐条渲染后的词缀文本，供 agent prompt 使用。 */
  rendered: readonly string[];
  /** 含 damage op 的词缀文本，供舞台记忆分解。 */
  damageLines: readonly string[];
}>;
