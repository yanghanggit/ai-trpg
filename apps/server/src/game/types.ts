import type { CommunicationActionType, MessageVisibility, MovementActionType } from "./actions";

export type { CommunicationActionType, MessageVisibility, MovementActionType } from "./actions";

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
};

/** 场景图的初始有向连接；两端引用 `Stage.key`。 */
export type Connection = {
  from: string;
  to: string;
};

/**
 * World 内的初始 actor 定义，包含根属性、初始物品、技能、状态与初始死亡状态。
 *
 * `death` 省略时按 false 写入；创建后由交互等行动更新数据库中的 `death`。
 * `statusEffects` 与运行时 `items` 是 actor 的两个容器。
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
  statusEffects: readonly StatusEffect[];
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

/** 一次交互（interact）希望达成的结果；五者都是交互分支，与技能无关。 */
export type InteractPurpose =
  | { kind: "damage"; targetActorName: string }
  | { kind: "steal"; targetActorName: string; itemName: string }
  | { kind: "give"; targetActorName: string; itemName: string }
  | { kind: "pickup"; itemName: string }
  | { kind: "use"; itemName: string; targetActorName?: string; targetStageName?: string };

export type InteractPurposeKind = InteractPurpose["kind"];

/**
 * 交互分支的行为属性。
 *
 * `broadcast` 与 `resolution` 描述的是“这个分支本身怎么结算、给谁看”，
 * 所以挂在目的上。
 */
export type InteractBranch = {
  broadcast: MessageVisibility;
  resolution: "computed" | "llm";
};

/** 未来 buff/debuff 的状态条目；目前只作为 actor 的状态队列容器。 */
export type StatusEffect = {
  key: string;
  name: string;
  description: string;
  kind: "buff" | "debuff";
};

export type CommunicationIntent = {
  kind: "communication";
  mind: string;
  mode: CommunicationActionType;
  targetActorName?: string;
  message: string;
};

export type MovementIntent = {
  kind: "movement";
  mode: MovementActionType;
  targetStageName?: string;
};

/**
 * 一次交互 intent。
 *
 * 交互是与沟通、移动平级的第三类顶层行动：想达成什么结果（`purpose`）、
 * 搭配哪些自己的道具（`itemNames`）。`damage` / `steal` / `give` / `pickup` /
 * `use` 都是交互分支；攻击走 `damage` 分支，当前不引入技能。
 */
export type InteractIntent = {
  kind: "interact";
  purpose: InteractPurpose;
  itemNames: readonly string[];
};

/** 顶层行动只有三类：沟通、移动、交互。 */
export type ActorIntent = CommunicationIntent | MovementIntent | InteractIntent;

export type ActorPlan = {
  intents: ActorIntent[];
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

/** 运行时 actor；`items`、`statusEffects` 是两个队列。 */
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
  statusEffects: StatusEffect[];
};

export type StageState = {
  id: string;
  name: string;
  profile: string;
  environment: string;
  ordinal: number;
  actors: ActorState[];
  items: ItemState[];
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
