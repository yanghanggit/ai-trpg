import { GameError } from "./errors";
import type { ConnectionState, PassageState } from "./types";

/**
 * 场景连通性的唯一形状：一条有向边 + 通行状态。
 *
 * 图是有向的，**不做对称推导**：双向通行必须显式存在两条边。`sealed` 表示两侧在
 * 剧情上相连、当前无法通过，只能由持有相应能力的 stage 把自己的出边打开。
 */
export type StageEdge = {
  fromStageId: string;
  toStageId: string;
  passage: PassageState;
};

type EdgeSource = Pick<ConnectionState, "fromStageId" | "toStageId" | "passage">;

/** 按起点索引的只读投影；每次从数据库读出的边现建，不做跨请求缓存。 */
export type EdgeIndex = {
  outgoing: (stageId: string) => StageEdge[];
};

/** 把边列表归一成按起点索引的查询结构；不做对称或隐式推断。 */
export function buildEdgeIndex(edges: readonly EdgeSource[]): EdgeIndex {
  const byFrom = new Map<string, StageEdge[]>();
  for (const edge of edges) {
    const outgoing: StageEdge = {
      fromStageId: edge.fromStageId,
      toStageId: edge.toStageId,
      passage: edge.passage,
    };
    const list = byFrom.get(edge.fromStageId);
    if (list) {
      list.push(outgoing);
    } else {
      byFrom.set(edge.fromStageId, [outgoing]);
    }
  }
  return { outgoing: (stageId) => byFrom.get(stageId) ?? [] };
}

/** 从 `from` 出发的可通行邻居 id。 */
export function openNeighborIds(index: EdgeIndex, fromStageId: string): string[] {
  return index
    .outgoing(fromStageId)
    .filter((edge) => edge.passage === "open")
    .map((edge) => edge.toStageId);
}

/** 从 `from` 出发、尚未开启的邻居 id。 */
export function sealedNeighborIds(index: EdgeIndex, fromStageId: string): string[] {
  return index
    .outgoing(fromStageId)
    .filter((edge) => edge.passage === "sealed")
    .map((edge) => edge.toStageId);
}

/** 校验一条待写入的边；跨 world 由调用方按 id 解析保证。 */
export function assertEdgeShape(fromStageId: string, toStageId: string): void {
  if (fromStageId === toStageId) {
    throw new GameError("invalid_state", "场景不能连接到自身");
  }
}
