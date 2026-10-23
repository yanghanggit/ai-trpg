/** 公共消息的可见范围：场景公开或仅当事人可见。 */
export type MessageVisibility = "stage" | "private";

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
  /** 暂放在场景中的物品；目前只物化为只读场景内容，拾取尚未实现。 */
  items?: readonly Item[];
  /** 场景自身的能力清单；必须显式列出，目前只有 submit_environment。 */
  actions: readonly StageActionKind[];
};

/** 场景图的初始有向连接；两端引用 `Stage.key`。 */
export type Connection = {
  from: string;
  to: string;
};

/**
 * World 内的初始 actor 定义，包含根属性、初始物品、状态与初始死亡状态。
 *
 * `death` 省略时按 false 写入；创建后由交互等行动更新数据库中的 `death`。
 */
export type Actor = {
  stageKey: string;
  name: string;
  profile: string;
  appearance: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  death?: boolean;
  items: readonly Item[];
  /** 该角色可用的动作；必须显式列出，不给默认值。 */
  actions: readonly ActionKind[];
};

/** Actor 的初始物品定义；创建后物化为 `items` 或 `stage_items` 行。 */
export type Item = {
  name: string;
  description: string;
  kind: string;
  count?: number;
  damage?: number;
  block?: number;
};

/** item 的武器子类型；count 固定为 1，额外提供伤害与格挡。 */
export type Weapon = Item & {
  kind: "weapon";
  count: 1;
  damage: number;
  block: number;
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

export type ItemState = {
  id: string;
  name: string;
  description: string;
  kind: string;
  count: number;
  damage: number;
  block: number;
};

/** 运行时 actor；`items` 是它的物品队列，`actions` 是它被允许的动作。 */
export type ActorState = {
  id: string;
  name: string;
  profile: string;
  appearance: string;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  death: boolean;
  items: ItemState[];
  actions: readonly ActionKind[];
};

export type StageState = {
  id: string;
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
