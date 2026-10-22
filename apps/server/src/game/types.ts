import type { CommunicationActionType, MessageVisibility, MovementActionType } from "./actions";

export type { CommunicationActionType, MessageVisibility, MovementActionType } from "./actions";

/**
 * 创建游戏时物化为运行时 world 的初始内容定义。
 *
 * 不是数据库行，也不是测试夹具；`createGame` 读取它并在一个事务中写入
 * `worlds`、`stages`、`actors` 与 `items`。创建完成后以数据库为唯一真相。
 */
export type World = {
  contentVersion: string;
  worldName: string;
  campaignSetting: string;
  systemRules: string;
  initialNarration?: string;
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
  narrative: string;
};

/** 场景图的初始有向连接；两端引用 `Stage.key`。 */
export type Connection = {
  from: string;
  to: string;
};

/**
 * World 内的初始 actor 定义，包含根属性、初始物品与初始死亡状态。
 *
 * `death` 省略时按 false 写入；创建后由攻击等行动更新数据库中的 `death`。
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
};

/** Actor 的初始物品定义；创建后物化为 `items` 行。 */
export type Item = {
  name: string;
  description: string;
  kind: string;
};

/** `createGame` 的输入；`world` 只在创建时读取，之后以数据库状态为准。 */
export type CreateGameInput = {
  username: string;
  name?: string;
  slug?: string;
  world: World;
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

export type AttackIntent = {
  kind: "attack";
  targetActorName: string;
};

export type ActorIntent = CommunicationIntent | MovementIntent | AttackIntent;

export type ActorPlan = {
  intents: ActorIntent[];
};

export type ItemState = {
  id: string;
  name: string;
  description: string;
  kind: string;
};

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
};

export type StageState = {
  id: string;
  name: string;
  profile: string;
  environment: string;
  narrative: string;
  ordinal: number;
  actors: ActorState[];
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
