import type { PassageState, SignatureNameState } from "../kernel/types";

/**
 * 客户端用的「世界面」投影形状。
 *
 * 这些类型是读侧契约：客户端只依赖它们，不依赖数据库形状。两条约定写在这里，
 * 免得每个字段的注释各说一遍：
 * - 引用（`token` / `ref`）由引擎按观察者渲染，客户端可以直接拿它提交行动；
 * - 公共标签（舞台名、道具名、大类）不做观察者遮蔽，遮蔽只发生在引用与记忆上。
 */

export type ViewerAddress = {
  actorId: string;
  signatureId: string;
  /** 引用，例如 `#3`；客户端可以直接拿它提交行动。 */
  token: string;
  /** 观察者视角下的名单写法：`名字（此刻的样子）` 或只有外观。 */
  label: string;
  self: boolean;
  alive: boolean;
};

export type ViewerItem = { name: string; kind: string; description: string };

/** 锚点连它承载的道具一起给；道具不再有独立的扁平列表。 */
export type ViewerAnchor = {
  key: string;
  label: string;
  description?: string;
  items: ViewerItem[];
};

export type ViewerStage = {
  id: string;
  name: string;
  environment: string;
  /** 公共标签，不做观察者遮蔽。 */
  anchors: ViewerAnchor[];
  actors: ViewerAddress[];
  /** 出口同时给真实舞台名与 #实体序号，客户端可自行决定遮蔽。 */
  exits: { stageId: string; name: string; ref: string }[];
  /** 去过、但现在封着的出口：认得出名字，但过不去。不是可移动目标。 */
  sealedExits: { stageId: string; name: string }[];
};

export type ViewerLogEntry = {
  sequence: number;
  kind: string;
  content: string;
  createdAt: string;
};

/** 两个视图共用的游戏头；不随观察者变化。 */
export type ViewerGame = {
  id: string;
  slug: string;
  status: string;
  version: number;
  contentVersion: string;
};

export type ActorView = {
  game: ViewerGame;
  viewer: {
    actorId: string;
    signatureId: string;
    /** 自己的本名；自知不查名字表。 */
    name: string;
    appearance: string;
  };
  stage: ViewerStage | null;
  /** 这个观察者给各签名的当前称呼；其它观察者的名字不出现。 */
  signatureNames: SignatureNameState[];
  /** 这个角色实际感知到的记忆，按发生顺序。 */
  log: ViewerLogEntry[];
  /** 去过的舞台（地图/记忆用）；不等于完整可传送列表。 */
  visitedStages: { stageId: string; name: string }[];
  /** 已去过且未被 teleport_blocked 的候选；不是完整的可传送集合。 */
  teleportTargets: { stageId: string; name: string }[];
};

export type StageViewLogEntry = {
  sequence: number;
  kind: string;
  /** 只有 stage_observation 携带。 */
  eventKind?: string;
  content: string;
  createdAt: string;
};

export type StageViewActor = {
  actorId: string;
  name: string;
  appearance: string;
  alive: boolean;
};

export type StageViewExit = {
  stageId: string;
  name: string;
  passage: PassageState;
};

export type StageView = {
  game: ViewerGame;
  viewer: {
    stageId: string;
    name: string;
  };
  stage: {
    id: string;
    name: string;
    environment: string;
    anchors: ViewerAnchor[];
    actors: StageViewActor[];
    exits: StageViewExit[];
  };
  log: StageViewLogEntry[];
};
