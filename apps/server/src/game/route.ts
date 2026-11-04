import assert from "node:assert/strict";
import { type ActorWithStage, requireStageName } from "./actors";
import { buildEdgeIndex, type EdgeIndex, type StageEdge } from "./edges";
import { GameError } from "./errors";
import { knownStageIds } from "./teleport";
import type { ConnectionState, GameStateSlice, RouteQuery, StageState } from "./types";

/**
 * 路线回忆：从 A 到 B 怎么走，结论写进 actor 自己的记忆。
 *
 * 回答始终是一条链，而不是「能不能到」的判定：能走通就写出整条路线；走不通就把链拉到
 * 断点、在断处标 `→[封着]→`。换一条路能到就照实给那一条。
 *
 * 端点必须是知道真名的场景（`#序号` 不行）；中间站不要求认识——不认识的场景用
 * `#实体序号` 顶上，和「看得见的出口」是同一种写法。
 */

/** 路线里的一个场景：只需要名字与序号，`#序号` 用于观察者还不认识的场景。 */
export type RouteNode = {
  id: string;
  seq: number;
  name: string;
  ordinal: number;
};

/** 路线只需要场景、边与「认识哪些场景」；`apply` 阶段按这三样窄读，不必装配整份状态。 */
export type RouteWorld = {
  stages: readonly RouteNode[];
  connections: readonly Pick<ConnectionState, "fromStageId" | "toStageId" | "passage">[];
  /** 观察者知道真名的场景（到访 ∪ 听说）；当前场景始终算在内。 */
  known: ReadonlySet<string>;
};

/** 问题本身：引用由模型或玩家给，id 由引擎解析后写入计划。 */
export type RouteQuestion = {
  /** 起点场景引用；省略表示观察者当前所在的场景。 */
  fromStageRef?: string;
  toStageRef: string;
};

export function routeWorldFromState(state: GameStateSlice, current: ActorWithStage): RouteWorld {
  const known = new Set(knownStageIds(state, current.actor.id));
  known.add(current.stage.id);
  return {
    stages: state.world.stages.map(({ id, seq, name, ordinal }) => ({ id, seq, name, ordinal })),
    connections: state.world.connections,
    known,
  };
}

/**
 * 把引用解析成端点 id，并检查「知道真名」。
 *
 * 端点只能是场景名：`#序号` 只是路上看得见、还没命名的站位，不能被拿来问路——
 * 否则「路上看到的东西」就倒过来变成了「可以指名的地方」。解析失败只用调用方给的
 * 引用回话，拒绝信息本身不透露任何地形。
 */
export function resolveRouteQuestion(
  state: GameStateSlice,
  current: ActorWithStage,
  question: RouteQuestion,
): RouteQuery {
  const from =
    question.fromStageRef === undefined
      ? current.stage
      : resolveKnownStage(state, current, question.fromStageRef);
  const to = resolveKnownStage(state, current, question.toStageRef);
  return { fromStageId: from.id, toStageId: to.id };
}

function resolveKnownStage(
  state: GameStateSlice,
  current: ActorWithStage,
  ref: string,
): StageState {
  const stage = requireStageName(state, ref);
  if (stage.id === current.stage.id) {
    return stage;
  }
  if (!knownStageIds(state, current.actor.id).has(stage.id)) {
    throw new GameError("invalid_action", `你还没听说过这个场景: ${stage.name}`);
  }
  return stage;
}

/** 一次 BFS 的结果：到各节点的距离与前驱，足够还原任意一条路径。 */
type Search = {
  distance: Map<string, number>;
  previous: Map<string, string>;
};

/** `passable` 决定哪些边可走；同层按场景序号取序，保证结果稳定。 */
function search(
  index: EdgeIndex,
  nodes: Map<string, RouteNode>,
  start: string,
  passable: (edge: StageEdge) => boolean,
): Search {
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
      .filter(passable)
      .map((edge) => edge.toStageId)
      .filter((id) => !distance.has(id))
      .sort((left, right) => ordinalOf(nodes, left) - ordinalOf(nodes, right));
    for (const id of next) {
      distance.set(id, steps + 1);
      previous.set(id, current);
      queue.push(id);
    }
  }
  return { distance, previous };
}

/** 从 `start` 顺着前驱还原到 `goal` 的路径；不可达时返回 undefined。 */
function pathTo(result: Search, start: string, goal: string): string[] | undefined {
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

function distanceOf(result: Search, id: string): number {
  const distance = result.distance.get(id);
  assert(distance !== undefined, `BFS 距离缺失: ${id}`);
  return distance;
}

function ordinalOf(nodes: Map<string, RouteNode>, id: string): number {
  const node = nodes.get(id);
  assert(node, `场景索引缺少节点: ${id}`);
  return node.ordinal;
}

/** 反向边集：用来问「从这里还能不能到 B」。 */
function reverseIndex(world: RouteWorld): EdgeIndex {
  return buildEdgeIndex(
    world.connections.map((edge) => ({
      fromStageId: edge.toStageId,
      toStageId: edge.fromStageId,
      passage: edge.passage,
    })),
  );
}

/** 走不通时最多报几条断点：多到能说明「哪几条路都断了」，又不至于把整张图倒出来。 */
const MAX_BREAKS = 3;

/** 链上的场景按观察者认知渲染：知道真名写名字，否则写 `#序号`。 */
function renderChain(nodes: Map<string, RouteNode>, world: RouteWorld, path: readonly string[]) {
  return path
    .map((id) => {
      const node = nodes.get(id);
      assert(node, `场景索引缺少节点: ${id}`);
      return world.known.has(id) ? node.name : `#${node.seq}`;
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

  const forward = search(index, nodes, from.id, isOpen);
  const direct = pathTo(forward, from.id, to.id);
  if (direct) {
    return `${title}\n${renderChain(nodes, world, direct)}（${direct.length - 1} 步）`;
  }

  // 走不通：从终点反向再搜一次，两面之间封着的门就是断点。
  const backward = search(reverseIndex(world), nodes, to.id, isOpen);
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
