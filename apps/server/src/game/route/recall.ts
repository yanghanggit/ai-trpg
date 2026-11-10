import assert from "node:assert/strict";
import {
  buildEdgeIndex,
  distanceOf,
  pathTo,
  reverseEdges,
  type StageEdge,
  search,
} from "../stage-state";
import type { RouteQuery } from "../types";
import type { RouteNode, RouteWorld } from "./types";

/**
 * 路线回忆的选路：先找能走通的链；走不通就从终点反向再搜一次，把两面之间封着的门当断点。
 *
 * 遍历原语来自 `stage-state/graph.ts`；这里决定走哪条、断在哪、报几条。文字在 `describe.ts`。
 */

/** 走不通时最多报几条断点：多到能说明「哪几条路都断了」，又不至于把整张图倒出来。 */
const MAX_BREAKS = 3;

/** 一条「走到封着的门」的链；`complete` 为 false 表示门后接不回终点，渲染时补 `…`。 */
export type SealedChain = {
  before: readonly string[];
  after: readonly string[];
  complete: boolean;
};

/**
 * 一次回忆的结论：同一场景、一条能走通的链、若干条断在封着的门前的链，或确实没有路。
 *
 * 只含场景 id，不含名字与文字——怎么称呼这些位置由渲染层按观察者认知决定。
 */
export type RoutePlan =
  | { kind: "here" }
  | { kind: "path"; path: readonly string[] }
  | { kind: "sealed"; chains: readonly SealedChain[] }
  | { kind: "unreachable" };

export function findRoute(world: RouteWorld, query: RouteQuery): RoutePlan {
  const nodes = indexStages(world);
  const from = nodes.get(query.fromStageId);
  const to = nodes.get(query.toStageId);
  assert(from, `路线起点不存在: ${query.fromStageId}`);
  assert(to, `路线终点不存在: ${query.toStageId}`);
  if (from.id === to.id) {
    return { kind: "here" };
  }

  const index = buildEdgeIndex(world.connections);
  const isOpen = (edge: StageEdge) => edge.passage === "open";
  const byOrdinal = (left: string, right: string) =>
    ordinalOf(nodes, left) - ordinalOf(nodes, right);

  const forward = search(index, from.id, { passable: isOpen, compare: byOrdinal });
  const direct = pathTo(forward, from.id, to.id);
  if (direct) {
    return { kind: "path", path: direct };
  }

  // 走不通：从终点反向再搜一次，两面之间封着的门就是断点。
  const backward = search(reverseEdges(world.connections), to.id, {
    passable: isOpen,
    compare: byOrdinal,
  });
  const breaks = world.connections
    .filter((edge) => edge.passage === "sealed")
    .filter((edge) => forward.distance.has(edge.fromStageId))
    .filter((edge) => backward.distance.has(edge.toStageId))
    .map((edge) => ({
      edge,
      cost: distanceOf(forward, edge.fromStageId) + distanceOf(backward, edge.toStageId),
    }))
    .sort(
      (left, right) =>
        left.cost - right.cost ||
        byOrdinal(left.edge.fromStageId, right.edge.fromStageId) ||
        byOrdinal(left.edge.toStageId, right.edge.toStageId),
    )
    .slice(0, MAX_BREAKS);

  if (breaks.length > 0) {
    return {
      kind: "sealed",
      chains: breaks.map(({ edge }) => {
        const before = pathTo(forward, from.id, edge.fromStageId);
        const after = pathTo(backward, to.id, edge.toStageId);
        assert(before && after, "断点路径缺失");
        return { before, after: [...after].reverse(), complete: true };
      }),
    };
  }

  // 连「对面能到 B」的门都找不到：只能说明最近的一扇门就把路截断了。
  const firstStopped = world.connections
    .filter((edge) => edge.passage === "sealed" && forward.distance.has(edge.fromStageId))
    .sort(
      (left, right) =>
        distanceOf(forward, left.fromStageId) - distanceOf(forward, right.fromStageId) ||
        byOrdinal(left.fromStageId, right.fromStageId),
    )
    .at(0);
  if (firstStopped) {
    const before = pathTo(forward, from.id, firstStopped.fromStageId);
    assert(before, "断点前的路径缺失");
    return {
      kind: "sealed",
      chains: [{ before, after: [firstStopped.toStageId], complete: false }],
    };
  }
  return { kind: "unreachable" };
}

function indexStages(world: RouteWorld): Map<string, RouteNode> {
  return new Map(world.stages.map((stage) => [stage.id, stage]));
}

function ordinalOf(nodes: Map<string, RouteNode>, id: string): number {
  const node = nodes.get(id);
  assert(node, `场景索引缺少节点: ${id}`);
  return node.ordinal;
}
