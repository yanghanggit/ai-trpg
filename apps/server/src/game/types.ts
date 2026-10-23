import type { ActorStats, ItemStats } from "./attributes";

export type { ActorStats, AttributeKey, Attributes, ItemStats } from "./attributes";

/** 公共消息的可见范围：场景公开或仅当事人可见。 */
export type MessageVisibility = "stage" | "private";

/** actor 的生命状态；不再使用 death 布尔值。 */
export type ActorStatus = "alive" | "dead";

/** 初始裸体形态：种族 + 外观描述；不含衣物与装备。 */
export type BaseBody = {
  race: string;
  description: string;
};

/** 物品大类；每个大类对应一个运行时子类。 */
export type ItemKind = "weapon" | "equipment" | "accessory" | "consumable" | "valuable";

/**
 * 创建游戏时物化为运行时 world 的初始内容定义。
 *
 * 不是数据库行，也不是测试夹具；`createGame` 读取它并在一个事务中写入
 * `worlds`、`stages`、`actors`、`items` 与 `stage_items`。创建完成后以数据库为唯一真相。
 */
export type World = {
  contentVersion: string;
  worldName: string;
  campaignSetting: string;
  systemRules: string;
  initialNarration?: string;
  /** 初始旁白所属场景；省略时使用 `stages[0]`。 */
  initialStageKey?: string;
  stages: readonly Stage[];
  connections: readonly Connection[];
  actors: readonly Actor[];
};

/** World 内的初始场景定义；`key` 仅在创建时用于连接与 actor 归属。 */
export type Stage = {
  key: string;
  name: string;
  profile: string;
  environment: string;
  /** 暂放在场景中的物品；创建时物化为 `stage_items`。 */
  items?: readonly ItemDefinition[];
  /** 场景自身的能力清单；必须显式列出，目前只有 submit_environment。 */
  actions: readonly StageActionKind[];
};

/** 场景图的初始有向连接；两端引用 `Stage.key`。 */
export type Connection = {
  from: string;
  to: string;
};

/**
 * World 内的初始 actor 定义，包含 base body、根属性、初始物品与初始状态。
 *
 * `status` 省略时按 alive 写入；创建后由攻击等行动更新数据库中的 `status`。
 * `baseBody` 是未穿装备的形态，之后与装备融合成 appearance。
 */
export type Actor = {
  stageKey: string;
  name: string;
  profile: string;
  baseBody: BaseBody;
  stats: ActorStats;
  status?: ActorStatus;
  items: readonly ItemDefinition[];
  /** 该角色可用的动作；必须显式列出，不给默认值。 */
  actions: readonly ActionKind[];
};

/** Actor 的初始物品定义；创建后物化为 `items` 或 `stage_items` 行。 */
export type ItemDefinition = {
  name: string;
  description: string;
  kind: ItemKind;
  count?: number;
  stats?: ItemStats;
};

/** `createGame` 的输入；`world` 只在创建时读取，之后以数据库状态为准。 */
export type CreateGameInput = {
  username: string;
  name?: string;
  slug?: string;
  world: World;
};

/** 公开对同场景的一个角色说话。 */
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

/** 向当前场景公开说话。 */
export type AnnounceAction = {
  kind: "announce";
  mind: string;
  message: string;
};

/** 沿连接移动到相邻场景。 */
export type MoveAction = {
  kind: "move";
  targetStageName: string;
};

/** 留在原地，不改变场景状态。 */
export type WaitAction = {
  kind: "wait";
};

/** 攻击同场景的一个角色，可搭配自己持有的武器道具。 */
export type AttackAction = {
  kind: "attack";
  targetActorName: string;
  itemNames: readonly string[];
};

/** 从同场景的一个角色身上取走一件物品。 */
export type StealAction = {
  kind: "steal";
  targetActorName: string;
  itemName: string;
};

/** 把自己持有的一件物品交给同场景的一个存活角色。 */
export type GiveAction = {
  kind: "give";
  targetActorName: string;
  itemName: string;
};

/** 拾起当前场景中的一件物品。 */
export type PickupAction = {
  kind: "pickup";
  itemName: string;
};

/** 使用自己持有的一件物品，作用于一个角色或当前场景。 */
export type UseAction = {
  kind: "use";
  itemName: string;
  targetActorName?: string;
  targetStageName?: string;
};

/** 一次 actor 行动；十个具体动作平级，不再有中间分类层。 */
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
  | UseAction;

export type ActionKind = ActorAction["kind"];

/** 场景作为小 GM 能执行的动作；当前只有提交 environment。 */
export type StageActionKind = "submit_environment";

/** 一轮计划：按提交顺序执行的动作列表；条数上限由 `MAX_ACTIONS_PER_TURN` 约束。 */
export type ActorPlan = {
  actions: ActorAction[];
};

/** stage 小 GM 的一次仲裁计划；当前只允许更新 environment。 */
export type StagePlan = {
  environment: string;
};

/** 所有物品的根状态：只保留身份、分类与数量，不带任何战斗数值。 */
export type ItemState = {
  id: string;
  name: string;
  description: string;
  kind: ItemKind;
  count: number;
};

/** 带战斗数值的物品：武器与装备共用 `stats`。 */
export type StatItemState = ItemState & { stats: ItemStats };

/** 武器：`stats.damage` 参与攻击，`stats.block` 只存储。 */
export type WeaponState = StatItemState & { kind: "weapon" };

/** 装备：`stats.block` 提供防御；当前不参与伤害计算。 */
export type EquipmentState = StatItemState & { kind: "equipment" };

/** 饰品：钥匙、护符等非战斗物品。 */
export type AccessoryState = ItemState & { kind: "accessory" };

/** 消耗品：使用后消耗；当前只有 `use` 的通用行为。 */
export type ConsumableState = ItemState & { kind: "consumable" };

/** 贵重物品：无战斗数值的剧情物品。 */
export type ValuableState = ItemState & { kind: "valuable" };

/** 运行时物品；按 `kind` 收窄到具体子类。 */
export type Item = WeaponState | EquipmentState | AccessoryState | ConsumableState | ValuableState;

/** 运行时 actor；`items` 是它的物品队列，`actions` 是它被允许的动作。 */
export type ActorState = {
  id: string;
  name: string;
  profile: string;
  baseBody: BaseBody;
  stats: ActorStats;
  status: ActorStatus;
  items: Item[];
  actions: readonly ActionKind[];
};

export type StageState = {
  id: string;
  name: string;
  profile: string;
  environment: string;
  ordinal: number;
  actors: ActorState[];
  items: Item[];
  actions: readonly StageActionKind[];
};

export type ConnectionState = {
  id: string;
  fromStageId: string;
  toStageId: string;
};

export type MessageState = {
  id: string;
  sequence: number;
  kind: string;
  stageId: string | null;
  speakerActorId: string | null;
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
  world: {
    id: string;
    name: string;
    campaignSetting: string;
    systemRules: string;
    stages: StageState[];
    connections: ConnectionState[];
  };
  messages: MessageState[];
};

export type ActorTurnResult = {
  ok: boolean;
  plan: ActorPlan | null;
  loopSuccess: boolean;
  state: GameState;
};

export type StageTurnResult = {
  ok: boolean;
  plan: StagePlan | null;
  loopSuccess: boolean;
  state: GameState;
};
