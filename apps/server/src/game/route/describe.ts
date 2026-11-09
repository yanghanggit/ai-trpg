import assert from "node:assert/strict";
import {
  buildEdgeIndex,
  distanceOf,
  pathTo,
  reverseEdges,
  type StageEdge,
  search,
} from "../stage-state";
import type { RouteFailure, RouteQuery } from "../types";
import type { RouteNode, RouteWorld } from "./types";

/**
 * 路线回忆的渲染：把一条路径写成 actor 记忆里那句话。
 *
 * 能走通就给整条链；走不通就把链拉到断点、在断处标 `→[封着]→`。这里只做文字，
 * 图怎么走由 `stage-state/graph.ts` 负责。
 */

/** 走不通时最多报几条断点：多到能说明「哪几条路都断了」，又不至于把整张图倒出来。 */
const MAX_BREAKS = 3;

/** 链上的场景按观察者认知渲染：走过的写名字，否则写 `#序号`。 */
function renderChain(
  nodes: Map<string, RouteNode>,
  world: RouteWorld,
  path: readonly string[],
): string {
  return path
    .map((id) => {
      const node = nodes.get(id);
      assert(node, `场景索引缺少节点: ${id}`);
      return world.visited.has(id) ? node.name : `#${node.seq}`;
    })
    .join(" → ");
}

function ordinalOf(nodes: Map<string, RouteNode>, id: string): number {
  const node = nodes.get(id);
  assert(node, `场景索引缺少节点: ${id}`);
  return node.ordinal;
}

/**
 * 封着的门写成链上的一段，读起来和走通的路是同一种形状。
 *
 * `complete` 为 false 表示门后面接不回终点：链停在门后那一站并加 `…`，
 * 说明「再往后的路说不出来」，而不是暗示还能走过去。
 */
function renderSealedChain(
  nodes: Map<string, RouteNode>,
  world: RouteWorld,
  before: readonly string[],
  after: readonly string[],
  complete: boolean,
): string {
  const chain = `${renderChain(nodes, world, before)} →[封着]→ ${renderChain(nodes, world, after)}`;
  return complete ? chain : `${chain} …`;
}

/**
 * 渲染一条路线：能走通给整条链，走不通把链拉到断点并标出封着的门。
 *
 * 这段文字只给模型读（进 actor 记忆，不进客户端），所以按模型好读来组织：
 * 标题一行说清问答，下面一条路径一行；多条断点不重复标题前缀。
 */
export function describeRoute(world: RouteWorld, query: RouteQuery): string {
  const nodes = new Map(world.stages.map((stage) => [stage.id, stage]));
  const from = nodes.get(query.fromStageId);
  const to = nodes.get(query.toStageId);
  assert(from, `路线起点不存在: ${query.fromStageId}`);
  assert(to, `路线终点不存在: ${query.toStageId}`);
  if (from.id === to.id) {
    return `你就在${from.name}，不用走。`;
  }
  const title = `从${from.name}到${to.name}：`;
  const index = buildEdgeIndex(world.connections);
  const isOpen = (edge: StageEdge) => edge.passage === "open";
  const byOrdinal = (left: string, right: string) =>
    ordinalOf(nodes, left) - ordinalOf(nodes, right);

  const forward = search(index, from.id, { passable: isOpen, compare: byOrdinal });
  const direct = pathTo(forward, from.id, to.id);
  if (direct) {
    return `${title}\n${renderChain(nodes, world, direct)}（${direct.length - 1} 步）`;
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
        ordinalOf(nodes, left.edge.fromStageId) - ordinalOf(nodes, right.edge.fromStageId) ||
        ordinalOf(nodes, left.edge.toStageId) - ordinalOf(nodes, right.edge.toStageId),
    )
    .slice(0, MAX_BREAKS);

  if (breaks.length > 0) {
    const lines = breaks.map(({ edge }) => {
      const before = pathTo(forward, from.id, edge.fromStageId);
      const after = pathTo(backward, to.id, edge.toStageId);
      assert(before && after, "断点路径缺失");
      return renderSealedChain(nodes, world, before, [...after].reverse(), true);
    });
    return [title, ...lines].join("\n");
  }

  // 连「对面能到 B」的门都找不到：只能说明最近的一扇门就把路截断了。
  const firstStopped = world.connections
    .filter((edge) => edge.passage === "sealed" && forward.distance.has(edge.fromStageId))
    .sort(
      (left, right) =>
        distanceOf(forward, left.fromStageId) - distanceOf(forward, right.fromStageId) ||
        ordinalOf(nodes, left.fromStageId) - ordinalOf(nodes, right.fromStageId),
    )
    .at(0);
  if (firstStopped) {
    const before = pathTo(forward, from.id, firstStopped.fromStageId);
    assert(before, "断点前的路径缺失");
    return `${title}\n${renderSealedChain(nodes, world, before, [firstStopped.toStageId], false)}`;
  }
  return `${title}\n没有能走通的路。`;
}

/**
 * 寻路失败的认知：只回述 actor 自己写的地名与固定原因，不透露地形。
 *
 * 写成一句和路线同构的短句（「从X出发，无法寻路：…」），模型在下一轮就能直接把
 * 这句话当成“这条路我认不出来”来用，不必再从工具回话里反推。
 */
export function describeRouteFailure(world: RouteWorld, failure: RouteFailure): string {
  const byId = new Map(world.stages.map((stage) => [stage.id, stage]));
  const from = failure.fromStageId === undefined ? undefined : byId.get(failure.fromStageId);
  const failingFrom = failure.fromStageId === undefined;
  const ref = failingFrom ? (failure.fromStageRef ?? "") : failure.toStageRef;
  const subject = failingFrom ? "起点" : "终点";
  const detail =
    failure.reason === "handle_ref"
      ? `「${ref}」不是场景名，#序号 只是看得见、还没命名的站位`
      : failure.reason === "ambiguous"
        ? `「${ref}」对应多个场景，说不清是哪一个`
        : failure.reason === "empty"
          ? `没有写${subject}`
          : `没有叫「${ref}」的场景`;
  const prefix = from ? `从${from.name}出发，` : "";
  return `${prefix}无法寻路：${detail}。`;
}
