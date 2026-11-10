import assert from "node:assert/strict";
import type { RouteFailure, RouteQuery } from "../types";
import { findRoute, type SealedChain } from "./recall";
import type { RouteNode, RouteWorld } from "./types";

/**
 * 路线回忆的渲染：把选好的结论写成 actor 记忆里那句话。
 *
 * 只做文字与称呼：链上的场景按观察者认知渲染，走过的写名字，否则写 `#序号`。
 * 选路与断点选择在 `recall.ts`，遍历原语在 `stage-state/graph.ts`。
 */

function indexStages(world: RouteWorld): Map<string, RouteNode> {
  return new Map(world.stages.map((stage) => [stage.id, stage]));
}

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

/**
 * 封着的门写成链上的一段，读起来和走通的路是同一种形状。
 *
 * `complete` 为 false 表示门后面接不回终点：链停在门后那一站并加 `…`，
 * 说明「再往后的路说不出来」，而不是暗示还能走过去。
 */
function renderSealedChain(
  nodes: Map<string, RouteNode>,
  world: RouteWorld,
  chain: SealedChain,
): string {
  const text = `${renderChain(nodes, world, chain.before)} →[封着]→ ${renderChain(nodes, world, chain.after)}`;
  return chain.complete ? text : `${text} …`;
}

/**
 * 渲染一条路线：能走通给整条链，走不通把链拉到断点并标出封着的门。
 *
 * 这段文字只给模型读（进 actor 记忆，不进客户端），所以按模型好读来组织：
 * 标题一行说清问答，下面一条路径一行；多条断点不重复标题前缀。
 */
export function describeRoute(world: RouteWorld, query: RouteQuery): string {
  const nodes = indexStages(world);
  const from = nodes.get(query.fromStageId);
  const to = nodes.get(query.toStageId);
  assert(from, `路线起点不存在: ${query.fromStageId}`);
  assert(to, `路线终点不存在: ${query.toStageId}`);

  const plan = findRoute(world, query);
  if (plan.kind === "here") {
    return `你就在${from.name}，不用走。`;
  }
  const title = `从${from.name}到${to.name}：`;
  if (plan.kind === "path") {
    return `${title}\n${renderChain(nodes, world, plan.path)}（${plan.path.length - 1} 步）`;
  }
  if (plan.kind === "sealed") {
    return [title, ...plan.chains.map((chain) => renderSealedChain(nodes, world, chain))].join(
      "\n",
    );
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
