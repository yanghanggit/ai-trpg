import type { Node } from "@xyflow/react";
import type { GameGraph } from "../../../features/games/useGameGraph";

/** 舞台节点：图上的一个小卡，画名字、句柄与人数。 */
export type StageNodeData = {
  stageId: string;
  name: string;
  seq: number;
  people: number;
  /** 顺位上的下一个人在这个舞台里。 */
  isNext: boolean;
  /** 第二层里的相邻舞台：淡一些，但可点。 */
  ghost?: boolean;
  /** 当前落地的那一层：加粗描边。 */
  root?: boolean;
};

/** actor 节点：名次、血量、控制方都写在同一张卡上。 */
export type ActorNodeData = {
  actorId: string;
  name: string;
  seq: number;
  hp: number;
  maxHp: number;
  /** 顺位名次；不在顺位上就是 `undefined`。 */
  position?: number;
  turnsTaken?: number;
  control?: "agent" | "player";
  alive: boolean;
  concealed: boolean;
  isDefaultPlayer: boolean;
  isNext: boolean;
};

export type StageFlowNode = Node<StageNodeData, "stage">;
export type ActorFlowNode = Node<ActorNodeData, "actor">;

/** 顺位条一行：直接从 `order.entries` 来，不另算名次。 */
export type QueueRow = {
  actorId: string;
  name: string;
  position: number;
  turnsTaken: number;
  control: "agent" | "player";
  alive: boolean;
  isNext: boolean;
};

/** 舞台第二层：根、按顺位排好的 actor、还有能走到的邻舞台。 */
export type StageView = {
  stage: GameGraph["stages"][number];
  actors: {
    actor: GameGraph["actors"][number];
    entry: QueueRow | undefined;
  }[];
  neighbours: {
    stage: GameGraph["stages"][number];
    passage: "open" | "sealed";
    /** `out` = 从这里出去，`in` = 从那边进来。 */
    direction: "out" | "in";
  }[];
};

/** 检索用的一条实体：舞台、actor、道具都归一成的形状。 */
export type EntityRef = {
  kind: "stage" | "actor" | "item";
  id: string;
  label: string;
  /** 在哪个舞台下（道具是持有者的舞台，舞台是自己）。 */
  stageId: string;
  /** 道具挂在谁身上。 */
  actorId?: string;
  /** 检索时一并匹配的别名与描述，不显示。 */
  keywords: string;
};
