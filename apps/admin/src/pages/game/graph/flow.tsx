import { type Edge, MarkerType } from "@xyflow/react";
import type { GameGraph } from "../../../features/games/useGameGraph";
import ActorNode from "./ActorNode";
import {
  ACTOR_NODE,
  handlesFor,
  layoutStageActors,
  layoutStages,
  leftmost,
  type Positions,
  STAGE_NODE,
} from "./layout";
import StageNode from "./StageNode";
import type { ActorFlowNode, StageFlowNode } from "./types";
import type { ConnectionPair } from "./viewModel";
import { censusOf, connectionPairs, nextStageId, stageCensus, stageView } from "./viewModel";

/**
 * 契约到画布的翻译：两张图都从这里出，节点与边的读法只写一遍。
 *
 * `nodeTypes` 必须是模块级常量——每次渲染新建一份，xyflow 会把整张图重挂一遍。
 */
export const nodeTypes = { stage: StageNode, actor: ActorNode };

const OPEN_STROKE = "rgb(125 211 252 / 60%)";
/** 封锁的方向不用同一支箭头颜色：灰要灰得明显，比 accent 暗一档。 */
const OPEN_MARKER = "rgb(125 211 252 / 85%)";
const SEALED_MARKER = "rgb(148 163 184 / 90%)";
const SEALED_STROKE = "rgb(148 163 184 / 70%)";
const LINK_STROKE = "rgb(139 155 176 / 30%)";

function marker(passage: "open" | "sealed") {
  return {
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
    color: passage === "open" ? OPEN_MARKER : SEALED_MARKER,
  };
}

/**
 * 一对舞台一条线。
 *
 * 方向只靠箭头：有哪个方向就画哪个方向的箭头（两端都有就是双向），
 * 箭头按自己那个方向的上色——可通行是 accent，封着是灰。
 * 线本身只说「有没有路」：至少一个方向通是实线，全封着是虚线。
 *
 * `source` 必须是画面上左边那个节点：箭头的一端落在哪，读的是画布而不是 id 顺序。
 * `data.pair` 原样带着两个方向的状态，点线的弹窗直接用，不必再查。
 */
function pairEdge(pair: ConnectionPair, source: string, positions: Positions): Edge {
  const target = pair.stageIds[0] === source ? pair.stageIds[1] : pair.stageIds[0];
  const { sourceHandle, targetHandle } = handlesFor(positions, source, target);
  // 画线方向是 source → target，所以「正向」是 source 出发的那条。
  const forward = pair.directions.find((direction) => direction.from === source);
  const backward = pair.directions.find((direction) => direction.from === target);

  return {
    id: pair.id,
    source,
    target,
    sourceHandle,
    targetHandle,
    data: { pair },
    ...(backward === undefined ? {} : { markerStart: marker(backward.passage) }),
    ...(forward === undefined ? {} : { markerEnd: marker(forward.passage) }),
    style: {
      stroke: pair.passable ? OPEN_STROKE : SEALED_STROKE,
      strokeWidth: 1.4,
      ...(pair.passable ? {} : { strokeDasharray: "6 4" }),
    },
  };
}

/** 第一层：世界图。舞台按 `ordinal` 进布局，坐标只取决于拓扑。 */
export function worldFlow(graph: GameGraph): { nodes: StageFlowNode[]; edges: Edge[] } {
  const stages = [...graph.stages].sort((left, right) => left.ordinal - right.ordinal);
  const census = stageCensus(graph);
  const next = nextStageId(graph);

  const positions = layoutStages(
    stages.map((stage) => stage.id),
    graph.connections.map((connection) => ({
      from: connection.fromStageId,
      to: connection.toStageId,
    })),
  );

  const nodes: StageFlowNode[] = stages.map((stage) => ({
    id: stage.id,
    type: "stage",
    position: positions.get(stage.id) ?? { x: 0, y: 0 },
    data: {
      stageId: stage.id,
      name: stage.name,
      seq: stage.seq,
      census: censusOf(census, stage.id),
      isNext: stage.id === next,
    },
    ...STAGE_NODE,
  }));

  const edges = connectionPairs(graph).map((pair) =>
    pairEdge(pair, leftmost(positions, pair.stageIds), positions),
  );

  return { nodes, edges };
}

/**
 * 第二层：舞台为根。
 *
 * 邻舞台走 dagre 的左右分层（进来在左、出去在右），actor 按顺位挂在根下面——
 * 三组坐标互不打扰，但都从 `stage` 这一个节点长出来。
 */
export function stageFlow(
  graph: GameGraph,
  stageId: string,
): { nodes: (StageFlowNode | ActorFlowNode)[]; edges: Edge[] } {
  const view = stageView(graph, stageId);
  if (view === undefined) {
    return { nodes: [], edges: [] };
  }

  const census = stageCensus(graph);
  const next = nextStageId(graph);

  const ghostIds: string[] = [];
  for (const neighbour of view.neighbours) {
    if (neighbour.stage.id !== stageId && !ghostIds.includes(neighbour.stage.id)) {
      ghostIds.push(neighbour.stage.id);
    }
  }

  // 根与邻舞台一起分层：进来在左、出去在右。
  const neighbourPositions = layoutStages(
    [stageId, ...ghostIds],
    view.neighbours.flatMap((neighbour) => {
      const edges: { from: string; to: string }[] = [];
      if (neighbour.out !== null) {
        edges.push({ from: stageId, to: neighbour.stage.id });
      }
      if (neighbour.in !== null) {
        edges.push({ from: neighbour.stage.id, to: stageId });
      }
      return edges;
    }),
    { rankdir: "LR" },
  );

  const rootPosition = neighbourPositions.get(stageId) ?? { x: 0, y: 0 };

  const actorPositions = layoutStageActors(
    view.actors.map((item) => item.actor.id),
    { rootWidth: STAGE_NODE.width, rootHeight: STAGE_NODE.height },
  );

  const nodes: (StageFlowNode | ActorFlowNode)[] = [
    {
      id: stageId,
      type: "stage",
      position: rootPosition,
      data: {
        stageId,
        name: view.stage.name,
        seq: view.stage.seq,
        census: censusOf(census, stageId),
        isNext: stageId === next,
        root: true,
      },
      ...STAGE_NODE,
    },
  ];

  for (const neighbour of view.neighbours) {
    if (neighbour.stage.id === stageId) {
      continue;
    }
    const position = neighbourPositions.get(neighbour.stage.id);
    if (position === undefined) {
      continue;
    }
    nodes.push({
      id: neighbour.stage.id,
      type: "stage",
      position,
      data: {
        stageId: neighbour.stage.id,
        name: neighbour.stage.name,
        seq: neighbour.stage.seq,
        census: censusOf(census, neighbour.stage.id),
        isNext: neighbour.stage.id === next,
        ghost: true,
      },
      ...STAGE_NODE,
    });
  }

  for (const { actor, entry } of view.actors) {
    const relative = actorPositions.get(actor.id);
    if (relative === undefined) {
      continue;
    }
    nodes.push({
      id: actor.id,
      type: "actor",
      position: {
        x: rootPosition.x + relative.x,
        y: rootPosition.y + relative.y,
      },
      data: {
        actorId: actor.id,
        name: actor.name,
        seq: actor.seq,
        hp: actor.hp,
        maxHp: actor.maxHp,
        ...(entry === undefined
          ? {}
          : {
              position: entry.position,
              turnsTaken: entry.turnsTaken,
              control: entry.control,
            }),
        alive: entry?.alive ?? actor.hp > 0,
        concealed: actor.concealed,
        isDefaultPlayer: actor.isDefaultPlayer,
        isNext: entry?.isNext ?? false,
      },
      ...ACTOR_NODE,
    });
  }

  // 与第一层同一套读法：这张图只保留与根有关的那几对。
  const edges: Edge[] = connectionPairs({
    ...graph,
    connections: graph.connections.filter(
      (connection) => connection.fromStageId === stageId || connection.toStageId === stageId,
    ),
  }).map((pair) => pairEdge(pair, leftmost(neighbourPositions, pair.stageIds), neighbourPositions));

  // actor 之间画成一条脊柱：根 → 第一名 → 下一名……
  // 每人各连一根到根的话，线会从后面的卡片里穿过去。
  const columns = new Map<number, string[]>();
  for (const { actor } of view.actors) {
    const relative = actorPositions.get(actor.id);
    if (relative === undefined) {
      continue;
    }
    const key = Math.round(relative.x);
    columns.set(key, [...(columns.get(key) ?? []), actor.id]);
  }
  const links: { id: string; source: string; target: string }[] = [];
  const [firstColumn] = [...columns.keys()].sort((left, right) => left - right);
  for (const [x, actorIds] of columns) {
    const head = actorIds[0];
    if (head !== undefined && x === firstColumn) {
      links.push({ id: `holds:${head}`, source: stageId, target: head });
    }
    for (let index = 1; index < actorIds.length; index += 1) {
      const previous = actorIds[index - 1];
      const current = actorIds[index];
      if (previous !== undefined && current !== undefined) {
        links.push({ id: `next:${previous}:${current}`, source: previous, target: current });
      }
    }
  }

  for (const link of links) {
    edges.push({
      id: link.id,
      source: link.source,
      target: link.target,
      sourceHandle: "bottom",
      targetHandle: "top",
      style: { stroke: LINK_STROKE, strokeWidth: 1.2 },
    });
  }

  return { nodes, edges };
}

/** 编排表里点一个人时要知道去哪一层：先找到人，再找他的舞台。 */
export function actorStageId(graph: GameGraph, actorId: string): string | undefined {
  return graph.actors.find((actor) => actor.id === actorId)?.stageId;
}
