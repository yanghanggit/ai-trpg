import assert from "node:assert/strict";
import { GameError } from "../errors";
import type { ConnectionState, PassageState } from "../kernel/types";

/**
 * 场景之间的图：边的形状、按起点索引、以及在这张图上走路。
 *
 * 有向且**不做对称推导**：双向通行必须显式存在两条边。`sealed` 是剧情相连但当前不可通过，
 * 只能由持有相应能力的 stage 打开自己的出边。
 *
 * 走路的规则只有一处——`passable` 由调用方给（问路只要 `open`），但「同层怎么排」
 * 与「怎么把距离还原成一条路径」留在这里，免得同一段 BFS 被写第二遍。
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

export function openNeighborIds(index: EdgeIndex, fromStageId: string): string[] {
  return index
    .outgoing(fromStageId)
    .filter((edge) => edge.passage === "open")
    .map((edge) => edge.toStageId);
}

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

/** 一次遍历的结果：到各节点的距离与前驱，足够还原任意一条路径。 */
export type GraphSearch = {
  distance: Map<string, number>;
  previous: Map<string, string>;
};

export type SearchOptions = {
  /** 哪些边能走：邻接只看 `open`，问路也一样。 */
  passable: (edge: StageEdge) => boolean;
  /** 同层的先后；调用方按场景序号给出，保证结果稳定。 */
  compare: (left: string, right: string) => number;
};

/** 按层推进的遍历；`compare` 决定同层顺序，所以同样的图总是给出同样的路径。 */
export function search(index: EdgeIndex, start: string, options: SearchOptions): GraphSearch {
  const distance = new Map([[start, 0]]);
  const previous = new Map<string, string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    assert(current, "BFS 队列取值为空");
    const steps = distance.get(current);
    assert(steps !== undefined, `BFS 距离缺失: ${current}`);
    const next = index
      .outgoing(current)
      .filter(options.passable)
      .map((edge) => edge.toStageId)
      .filter((id) => !distance.has(id))
      .sort(options.compare);
    for (const id of next) {
      distance.set(id, steps + 1);
      previous.set(id, current);
      queue.push(id);
    }
  }
  return { distance, previous };
}

/** 从 `start` 顺着前驱还原到 `goal` 的路径；不可达时返回 undefined。 */
export function pathTo(result: GraphSearch, start: string, goal: string): string[] | undefined {
  if (!result.distance.has(goal)) {
    return undefined;
  }
  const path = [goal];
  for (let step = goal; step !== start; ) {
    const prev = result.previous.get(step);
    assert(prev !== undefined, `路径前驱缺失: ${step}`);
    path.unshift(prev);
    step = prev;
  }
  return path;
}

/** 已知可达时的距离；调用方通常已经用 `pathTo` 确认过。 */
export function distanceOf(result: GraphSearch, id: string): number {
  const distance = result.distance.get(id);
  assert(distance !== undefined, `BFS 距离缺失: ${id}`);
  return distance;
}

/** 反向边集：用来问「从这里还能不能到 B」，不必再建一次索引规则。 */
export function reverseEdges(edges: readonly EdgeSource[]): EdgeIndex {
  return buildEdgeIndex(
    edges.map((edge) => ({
      fromStageId: edge.toStageId,
      toStageId: edge.fromStageId,
      passage: edge.passage,
    })),
  );
}
