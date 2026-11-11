import type { ConnectionState, RouteFailure, RouteQuery } from "../kernel/types";

/**
 * 路线回忆的输入与中间形状。
 *
 * `RouteQuery` / `RouteFailure` 是要写进计划的持久形状，住在 `types.ts`；这里只放
 * 一次回忆内用得到的视图：窄世界、问题、解析结果。
 */

/** 路线里的一个舞台：只需要名字与序号，`#序号` 用于观察者还没走过的舞台。 */
export type RouteNode = {
  id: string;
  seq: number;
  name: string;
  ordinal: number;
};

/** 路线只需要舞台、边与「走过哪些舞台」；结算事务按这三样窄读，不必装配整份状态。 */
export type RouteWorld = {
  stages: readonly RouteNode[];
  connections: readonly Pick<ConnectionState, "fromStageId" | "toStageId" | "passage">[];
  /** 观察者走过的舞台（到访 ∪ 当前舞台）；链上其余位置写成 `#序号`。 */
  visited: ReadonlySet<string>;
};

/** 问题本身：引用由模型或玩家给，id 由引擎解析后写入计划。 */
export type RouteQuestion = {
  /** 起点舞台引用；省略表示观察者当前所在的舞台。 */
  fromStageRef?: string;
  toStageRef: string;
};

/** 解析结果：要么拿到两个端点 id，要么记一次「寻路失败」进认知。 */
export type RouteResolution =
  | { ok: true; query: RouteQuery }
  | { ok: false; failure: RouteFailure };
