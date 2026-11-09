/**
 * 世界定义：建局时读一次、物化成数据库行，之后以数据库为唯一真相。
 *
 * 与运行时的 `WorldState` / `StageState` / `ActorState` 是两份 shape：定义侧用 `key` 引用彼此，
 * 状态侧用 id。校验在 `parse-world-content.ts`。
 */

import type { Stats } from "./attributes";
import type {
  AffixTriggers,
  CarriedActionKind,
  EquipmentSlots,
  InnateActionKind,
  ItemKind,
  PassageState,
  StageActionKind,
  WorldActionKind,
  WorldFunctionAgents,
} from "./types";

export type World = {
  contentVersion: string;
  /** 稳定内容标识（剧本 slug）：知识库 collection 用它寻址，改展示名不会断链。 */
  contentKey: string;
  worldName: string;
  /** 世界的自我设定：本剧本里它是什么、负责什么、什么算收束。 */
  profile: string;
  campaignSetting: string;
  globalRules: string;
  /**
   * 世界职能 agent，建局前在内容层定档、之后直接使用。
   *
   * 与 `globalRules` 一样属于开局快照：改代码或内容不影响已存在的局。
   */
  functionAgents: WorldFunctionAgents;
  stages: readonly Stage[];
  connections: readonly Connection[];
  actors: readonly Actor[];
  /** 开局时已经建立的名字绑定：观察者与对象都用 `Actor.key` 引用。 */
  signatureNames?: readonly WorldSignatureName[];
  /**
   * 开局前就去过、但不是此刻所在的场景。
   *
   * 到访是记忆而不是通行证：它让演员在自己相邻的出口里认出一道封着的门
   * （写名字而不是编号），但 `sealed` 边仍然走不过去。
   */
  visitedStages?: readonly WorldVisitedStage[];
  /** 世界实体可用的动作；必须显式列出。 */
  actions: readonly WorldActionKind[];
};

/**
 * 开局时就已建立的名字绑定。
 *
 * 等价于建局时替观察者执行一次 `recognize_identity`：`observer` 与 `subject` 用内容 key，
 * `name` 是观察者当前对这个签名的称呼；允许是真名、称号、误认或听来的叫法。
 */
export type WorldSignatureName = {
  observer: string;
  subject: string;
  name: string;
};

/** 开局前就去过的场景：`actor` / `stage` 都用内容 key。 */
export type WorldVisitedStage = {
  actor: string;
  stage: string;
};

/**
 * 内容层的锚点定义：锚点承载物品，物品不能脱离锚点。
 *
 * `key` 是场景内稳定标识，改 `label` 不会让挂在上面的物品失联。
 */
export type StageAnchorDefinition = {
  /** 场景内稳定标识；改 label 不会让挂在上面的物品失联。 */
  key: string;
  label: string;
  description?: string;
  /** 开局就摆在这个锚点上的物品；建局时物化为 `stage_items.anchor_key`。 */
  items?: readonly ItemDefinition[];
};

/** World 内的初始场景定义；`key` 仅在创建时用于连接与 actor 归属。 */
export type Stage = {
  key: string;
  name: string;
  profile: string;
  environment: string;
  /** 场景内可交互的锚点；物品只能挂在锚点上。 */
  anchors?: readonly StageAnchorDefinition[];
  /** 场景自身的能力清单；必须显式列出。 */
  actions: readonly StageActionKind[];
  /** 是否禁止 teleport 进出；普通 move 不受影响。 */
  teleportBlocked?: boolean;
};

/** 场景图的初始有向连接；两端引用 `Stage.key`，默认已通行。 */
export type Connection = {
  from: string;
  to: string;
  passage?: PassageState;
};

/**
 * World 内的初始 actor 定义。
 *
 * `signature` 是它开局时的形态与外观；`form` 必须写成 `种族:描述`，
 * 之后与装备、伤势一起渲染成 appearance。
 */
export type Actor = {
  /**
   * 内容层稳定标识：连接、开场知识等引用角色时用它，不用展示名。
   * 与 `Stage.key` / `ItemDefinition.key` 同义。
   */
  key: string;
  stageKey: string;
  name: string;
  profile: string;
  /**
   * 本局开局注入给该角色的私有简报；只写入 actor memory，不进入 actors 表。
   * 可以承载目标、任务、处境、约束与初始知识，不要求是目标列表。
   */
  openingBriefing?: string;
  /** 开局签名：稳定形态 + 预制外观快照；外观省略时回退到 `form`。 */
  signature: {
    form: string;
    appearance?: string;
  };
  /** 初始穿戴：槽位 → 物品名；物品本身不记录穿戴状态。 */
  equipment?: EquipmentSlots;
  /**
   * 完整属性；`maxHp` / `strength` / `wisdom` / `agility` / `damage` / `block` 全部显式写出。
   * 结算只读 `maxHp` / `damage` / `block`；力量 / 智慧 / 敏捷是保留属性，暂无读取点。
   */
  stats: Stats;
  /** 初始当前生命；省略时等于 `stats.maxHp`。`hp` 为 0 就是尸体。 */
  hp?: number;
  /** 是否为默认玩家角色；主角死亡时只通知 world，收尾由 world 回合决定。 */
  isDefaultPlayer?: boolean;
  /** 随身携带的道具；建局时物化成 `items` 行。 */
  inventory: readonly ItemDefinition[];
  /**
   * 成套的技艺：一项技艺可以带几个动作，建局时并入 `actions`。
   *
   * 它只是内容层的分组，不落库、不在运行时存在；物化后剩下的就是动作本身。
   * 同一个动作只能有一个来源：写在 `actions` 里，或者属于某一项技艺。
   */
  proficiencies?: readonly SkillDefinition[];
  /**
   * 该角色固有的行动；必须显式列出，不给默认值。
   *
   * 武器授予的动作不写在这里；属于某项技艺的动作也只写在技艺里，一个动作只有一个出处。
   */
  actions: readonly InnateActionKind[];
};

/**
 * 一项技艺：把几个动作捆在一个名字下的内容单元。
 *
 * 和物品的 `actions` 同形，但物品的授予随穿戴借还，技艺在开局时就变成角色自己的本事。
 * 名字是给内容与读者看的（「探囊」），机制只看 `actions`。
 */
export type SkillDefinition = {
  /** 角色内稳定标识；同一角色下不重复，改 `name` 不影响它。 */
  key: string;
  name: string;
  description: string;
  /** 这项技艺授予的动作；只能是没有携带者的固有动作。 */
  actions: readonly InnateActionKind[];
};

/** 角色实际固有的动作：自己声明的 ∪ 技艺授予的；建局时按它物化。 */
export function actorInnateActions(
  actor: Pick<Actor, "actions" | "proficiencies">,
): InnateActionKind[] {
  const merged = [
    ...actor.actions,
    ...(actor.proficiencies ?? []).flatMap((skill) => skill.actions),
  ];
  return [...new Set(merged)];
}

/** Actor 的初始物品定义；创建后物化为 `items` 或 `stage_items` 行。 */
export type ItemDefinition = {
  /** 世界内稳定 key；行为与内容判定用它，不用展示名。 */
  key: string;
  name: string;
  description: string;
  kind: ItemKind;
  count?: number;
  /** 属性；可省略，未写出的字段按 0 归一。 */
  stats?: Partial<Stats>;
  /** `cleave` 一次最多命中的目标数；只有 weapon 可声明，省略时物化为 1。 */
  maxTargets?: number;
  /** 按触发场景声明的词缀；可省略，创建时归一化为空对象。 */
  affixes?: AffixTriggers;
  /** 物品能提供的携带者动作；穿戴中才借给角色。可省略，创建时归一化为空数组。 */
  actions?: readonly CarriedActionKind[];
  /** 材料来源；只有 `material` 可以声明，其它大类声明会被内容校验拒绝。 */
  source?: string;
};
