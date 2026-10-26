import type { Stats } from "./attributes";

/** 公共消息的可见范围：场景公开或仅当事人可见。 */
export type MessageVisibility = "stage" | "private";

/** 初始裸体形态：种族 + 外观描述；不含衣物与装备。 */
export type BaseBody = {
  race: string;
  description: string;
};

/** 物品大类；每个大类对应一个运行时子类。 */
export type ItemKind = "weapon" | "equipment" | "accessory" | "consumable" | "valuable";

/**
 * 物品的声明式效果：只存可序列化 JSON，`type` 路由到 handler，物品不持有函数。
 */
export type ItemEffect = {
  type: string;
  [key: string]: unknown;
};

/**
 * actor 的穿戴槽：槽里只记录物品名，物品自身不知道被谁穿戴。
 * 开发期只保留一武器、一护甲（合并副手/头/身体/足部）、两饰品。
 */
export const EQUIPMENT_SLOTS = ["weapon", "armor", "accessory1", "accessory2"] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];
export type EquipmentSlots = Partial<Record<EquipmentSlot, string>>;

export const EQUIPMENT_SLOT_LABELS: Record<EquipmentSlot, string> = {
  weapon: "武器",
  armor: "护甲",
  accessory1: "饰品一",
  accessory2: "饰品二",
};

export const EQUIPMENT_SLOT_KINDS: Record<EquipmentSlot, readonly ItemKind[]> = {
  weapon: ["weapon"],
  armor: ["equipment"],
  accessory1: ["accessory"],
  accessory2: ["accessory"],
};

/**
 * 创建游戏时的初始内容定义；`createGame` 在一个事务里把它物化为数据库行，
 * 之后以数据库为唯一真相。
 */
export type World = {
  contentVersion: string;
  /** 稳定内容标识（剧本 slug）：知识库 collection 用它寻址，改展示名不会断链。 */
  contentKey: string;
  worldName: string;
  campaignSetting: string;
  systemRules: string;
  stages: readonly Stage[];
  connections: readonly Connection[];
  actors: readonly Actor[];
  /** 世界实体可用的动作；必须显式列出。 */
  actions: readonly WorldActionKind[];
};

/** World 内的初始场景定义；`key` 仅在创建时用于连接与 actor 归属。 */
export type Stage = {
  key: string;
  name: string;
  profile: string;
  environment: string;
  /** 暂放在场景中的物品；创建时物化为 `stage_items`。 */
  items?: readonly ItemDefinition[];
  /** 场景自身的能力清单；必须显式列出。 */
  actions: readonly StageActionKind[];
};

/** 场景边的通行状态；sealed 表示两侧在剧情上相连，但当前不能通过。 */
export type PassageState = "open" | "sealed";

/** 场景图的初始有向连接；两端引用 `Stage.key`，默认已通行。 */
export type Connection = {
  from: string;
  to: string;
  passage?: PassageState;
};

/**
 * World 内的初始 actor 定义。
 *
 * `baseBody` 是未穿装备的形态，之后与装备融合成 appearance。
 */
export type Actor = {
  stageKey: string;
  name: string;
  profile: string;
  /**
   * 本局开局注入给该角色的私有简报；只写入 actor memory，不进入 actors 表。
   * 可以承载目标、任务、处境、约束与初始知识，不要求是目标列表。
   */
  openingBriefing?: string;
  /** 当前可见外观（含衣着/装备）；省略时回退到 baseBody.description。 */
  appearance?: string;
  /** 初始穿戴：槽位 → 物品名；物品本身不记录穿戴状态。 */
  equipment?: EquipmentSlots;
  baseBody: BaseBody;
  /**
   * 完整属性；`maxHp` / `strength` / `wisdom` / `agility` / `damage` / `block` 全部显式写出。
   * 结算只读 `maxHp` / `damage` / `block`；力量 / 智慧 / 敏捷是保留属性，暂无读取点。
   */
  stats: Stats;
  /** 初始当前生命；省略时等于 `stats.maxHp`。`hp` 为 0 就是尸体。 */
  hp?: number;
  /** 是否为默认玩家角色；该角色死亡时整局结束。 */
  isDefaultPlayer?: boolean;
  items: readonly ItemDefinition[];
  /** 该角色能执行的行动；必须显式列出，不给默认值。 */
  actions: readonly ActionKind[];
};

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
  /** 物品效果；必须显式声明，type 路由到 handler。 */
  effect: ItemEffect;
  /** 词缀；可省略，创建时归一化为空数组。 */
  affixes?: readonly string[];
};

/** `createGame` 的输入；`world` 只在创建时读取，之后以数据库状态为准。 */
export type CreateGameInput = {
  username: string;
  name?: string;
  slug?: string;
  world: World;
};

export type SayAction = {
  kind: "say";
  mind: string;
  targetActorName: string;
  message: string;
};

/** 对同场景的一个角色耳语，只有对方能听见。 */
export type WhisperAction = {
  kind: "whisper";
  mind: string;
  targetActorName: string;
  message: string;
};

export type AnnounceAction = {
  kind: "announce";
  mind: string;
  message: string;
};

export type MoveAction = {
  kind: "move";
  targetStageName: string;
};

export type WaitAction = {
  kind: "wait";
};

/** 攻击同场景的一个角色；固定使用已装备的武器，没有可用武器时空手。 */
export type AttackAction = {
  kind: "attack";
  targetActorName: string;
};

export type StealAction = {
  kind: "steal";
  targetActorName: string;
  itemName: string;
};

/** 把自己持有的一件物品交给同场景的一个角色；尸体也可以是接收方。 */
export type GiveAction = {
  kind: "give";
  targetActorName: string;
  itemName: string;
};

export type PickupAction = {
  kind: "pickup";
  itemName: string;
};

/**
 * 使用自己持有的一件物品，作用于一个角色或当前场景。
 *
 * 所有引用物品的动作都遵循同一原则：动作是触发者，物品只是输入；
 * 每个动作最多引用一件物品，由动作声明是否必需与允许的类别。
 */
export type UseAction = {
  kind: "use";
  itemName: string;
  targetActorName?: string;
  targetStageName?: string;
  /** 对场景中具体位置/部位的描述；只是行动描述，不是结果。 */
  targetDetail?: string;
};

export type EquipAction = {
  kind: "equip";
  itemName: string;
  slot: EquipmentSlot;
};

export type UnequipAction = {
  kind: "unequip";
  slot: EquipmentSlot;
};

/** 一次 actor 行动；十二个具体动作平级，不再有中间分类层。 */
export type ActorAction =
  | SayAction
  | WhisperAction
  | AnnounceAction
  | MoveAction
  | WaitAction
  | AttackAction
  | StealAction
  | GiveAction
  | PickupAction
  | UseAction
  | EquipAction
  | UnequipAction;

export type ActionKind = ActorAction["kind"];

/** stage 的一次仲裁动作；与 actor / world 的计划同构，都是有序动作列表。 */
export type StageAction =
  | { kind: "submit_environment"; environment: string }
  | { kind: "notify_world"; notification: string }
  | { kind: "open_passage"; targetStageName: string };

/** 场景作为小 GM 能执行的动作；能力清单成员，由 `StageAction` 派生。 */
export type StageActionKind = StageAction["kind"];

/** 一轮计划：按提交顺序执行的动作列表；条数上限由 `MAX_ACTIONS_PER_TURN` 约束。 */
export type ActorPlan = {
  actions: ActorAction[];
};

/** stage 小 GM 的一轮仲裁计划：按提交顺序更新 environment 或向 world 发通知。 */
export type StagePlan = {
  actions: StageAction[];
};

/** world 对 stage 的下行动作。 */
export type WorldAction =
  | { kind: "notify_stage"; stageName: string; content: string }
  | { kind: "end_game"; message: string };

/** world 的能力清单成员；由 `WorldAction` 派生。 */
export type WorldActionKind = WorldAction["kind"];

/** world 的一轮计划。 */
export type WorldPlan = {
  actions: WorldAction[];
};

/** 所有物品状态的公共根字段：身份、分类、数量与属性。 */
export type ItemBaseState = {
  id: string;
  /** 世界内稳定 key；旧数据缺失时由 toItemState 回退到 name。 */
  key: string;
  name: string;
  description: string;
  kind: ItemKind;
  count: number;
  /** 物品效果；由内容显式声明，运行时按 type 路由。 */
  effect: ItemEffect;
  /** 词缀；非空时 damage 路由到 LLM 结算 handler。 */
  affixes: readonly string[];
  /** 归一化后的完整属性；五种物品都携带，未用到的字段为 0。 */
  stats: Stats;
};

/** 武器：`attack` 只读它的 `damage`；穿戴后 `block` 与其它槽一样计入减伤。 */
export type WeaponState = ItemBaseState & { kind: "weapon" };

/** 装备：不能用于出手，但穿戴后 `block` 计入减伤。 */
export type EquipmentState = ItemBaseState & { kind: "equipment" };

/** 饰品：随身携带的非战斗物品。 */
export type AccessoryState = ItemBaseState & { kind: "accessory" };

/** 可穿戴物品状态的联合，用于外观推理筛选。 */
export type WearableItemState = WeaponState | EquipmentState | AccessoryState;

/** 消耗品：数量语义保留；当前 `use` 不自动扣除 count。 */
export type ConsumableState = ItemBaseState & { kind: "consumable" };

/** 贵重物品：无战斗数值的剧情物品。 */
export type ValuableState = ItemBaseState & { kind: "valuable" };

export type ItemState =
  | WeaponState
  | EquipmentState
  | AccessoryState
  | ConsumableState
  | ValuableState;

export type ActorState = {
  id: string;
  name: string;
  profile: string;
  appearance: string;
  baseBody: BaseBody;
  stats: Stats;
  /** 当前生命；扣血只写这个字段，不再重写整块属性。`hp === 0` 即死亡。 */
  hp: number;
  /** 是否为默认玩家角色；该角色死亡时整局结束。 */
  isDefaultPlayer: boolean;
  equipment: EquipmentSlots;
  items: ItemState[];
  actions: readonly ActionKind[];
};

export type StageState = {
  id: string;
  /** 世界内稳定 key；旧数据缺失时回退到 name。 */
  key: string;
  name: string;
  profile: string;
  environment: string;
  ordinal: number;
  actors: ActorState[];
  items: ItemState[];
  actions: readonly StageActionKind[];
};

export type ConnectionState = {
  id: string;
  fromStageId: string;
  toStageId: string;
  passage: PassageState;
};

export type MessageState = {
  id: string;
  sequence: number;
  kind: string;
  stageId: string | null;
  sourceActorId: string | null;
  targetActorId: string | null;
  visibility: MessageVisibility;
  content: string;
  createdAt: string;
};

export type PlayerState = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
};

export type AgentMemoryMessageState = {
  sequence: number;
  type: "system" | "human" | "ai" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: unknown;
  metadata?: unknown;
  createdAt: string;
};

export type AgentMemoryState = {
  id: string;
  ownerType: string;
  ownerId: string;
  name: string;
  contextUsageRatio: number;
  messages: AgentMemoryMessageState[];
};

/** 运行时 world 状态；由 worlds/stages/stage_connections 表水合得到。 */
export type WorldState = {
  id: string;
  name: string;
  contentKey: string;
  campaignSetting: string;
  systemRules: string;
  actions: WorldActionKind[];
  stages: StageState[];
  connections: ConnectionState[];
};

export type GameState = {
  game: {
    id: string;
    ownerId: string;
    name: string;
    slug: string;
    status: string;
    contentVersion: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  };
  player: PlayerState;
  world: WorldState;
  messages: MessageState[];
};

/** 死亡阶段里一个没做成的收尾动作；失败不改变 hp，也不撤销已宣布的死亡。 */
export type DeathPhaseFailure = {
  actorName: string;
  reason: string;
};

/**
 * 一次死亡阶段的结果。
 *
 * 阶段本身不抛业务错误：单个死者失败只记录在这里，标记没写成，下次调用会重试。
 */
export type DeathPhaseResult = {
  /** 本次认领并宣布死亡的 actor。 */
  settled: string[];
  /** 认领、宣布或结束整局失败的 actor 与原因。 */
  failed: DeathPhaseFailure[];
  /** 死亡已宣布、但尸体外观快照没推成的 actor；按设计可以放着不管。 */
  appearanceFailed: string[];
};

export type ActorTurnResult = {
  ok: boolean;
  plan: ActorPlan | null;
  loopSuccess: boolean;
  state: GameState;
  /** 本次行动之后死亡阶段的结果；失败不回滚这次行动，但要让上层看得见。 */
  death?: DeathPhaseResult;
};

export type StageTurnResult = {
  ok: boolean;
  plan: StagePlan | null;
  loopSuccess: boolean;
  state: GameState;
};

export type WorldTurnResult = {
  ok: boolean;
  plan: WorldPlan | null;
  loopSuccess: boolean;
  state: GameState;
};
