import { type Edge, MarkerType } from "@xyflow/react";
import type { GameGraph } from "../../../features/games/useGameGraph";
import ActorNode from "./ActorNode";
import CurvedEdge from "./CurvedEdge";
import { ACTOR_NODE, layoutStageActors, layoutStages, STAGE_NODE } from "./layout";
import StageNode from "./StageNode";
import type { ActorFlowNode, StageFlowNode } from "./types";
import { nextStageId, queueRows, stagePeople, stageView } from "./viewModel";

/**
 * 契约到画布的翻译：两张图都从这里出，节点与边的读法只写一遍。
 *
 * `nodeTypes` 必须是模块级常量——每次渲染新建一份，xyflow 会把整张图重挂一遍。
 */
export const nodeTypes = { stage: StageNode, actor: ActorNode };
export const edgeTypes = { curved: CurvedEdge };

const OPEN_STROKE = "rgb(125 211 252 / 60%)";
const SEALED_STROKE = "rgb(139 155 176 / 55%)";
const LINK_STROKE = "rgb(139 155 176 / 30%)";

function stageEdge(id: string, source: string, target: string, sealed: boolean, offset = 0): Edge {
  return {
    id,
    source,
    target,
    type: "curved",
    data: { axis: "h", offset },
    sourceHandle: "right",
    targetHandle: "left",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: sealed ? SEALED_STROKE : OPEN_STROKE,
    },
    style: {
      stroke: sealed ? SEALED_STROKE : OPEN_STROKE,
      strokeWidth: 1.4,
      ...(sealed ? { strokeDasharray: "6 4" } : {}),
    },
  };
}

/** 第一层：世界图。舞台按 `ordinal` 进布局，坐标只取决于拓扑。 */
export function worldFlow(graph: GameGraph): { nodes: StageFlowNode[]; edges: Edge[] } {
  const stages = [...graph.stages].sort((left, right) => left.ordinal - right.ordinal);
  const people = stagePeople(graph);
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
      people: people.get(stage.id) ?? 0,
      isNext: stage.id === next,
    },
    ...STAGE_NODE,
  }));

  // 双向边各偏一侧，否则两条曲线完全重叠、只剩一个箭头。
  const drawn = new Set(
    graph.connections.map((connection) => `${connection.fromStageId}->${connection.toStageId}`),
  );
  const edges = graph.connections.map((connection) => {
    const reverse = drawn.has(`${connection.toStageId}->${connection.fromStageId}`);
    const offset = reverse ? (connection.fromStageId < connection.toStageId ? -16 : 16) : 0;
    return stageEdge(
      connection.id,
      connection.fromStageId,
      connection.toStageId,
      connection.passage === "sealed",
      offset,
    );
  });

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

  const people = stagePeople(graph);
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
    view.neighbours.map((neighbour) =>
      neighbour.direction === "out"
        ? { from: stageId, to: neighbour.stage.id }
        : { from: neighbour.stage.id, to: stageId },
    ),
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
        people: people.get(stageId) ?? 0,
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
        people: people.get(neighbour.stage.id) ?? 0,
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

  // 与第一层同理：相邻舞台常常双向相连，两条边要各偏一侧才看得出是两条。
  const directions = new Set(
    view.neighbours.map((neighbour) => `${neighbour.direction}:${neighbour.stage.id}`),
  );

  const edges: Edge[] = [];
  for (const neighbour of view.neighbours) {
    if (neighbour.stage.id === stageId) {
      continue;
    }
    const reverse = directions.has(
      `${neighbour.direction === "out" ? "in" : "out"}:${neighbour.stage.id}`,
    );
    const offset = reverse ? (neighbour.direction === "out" ? 16 : -16) : 0;
    edges.push(
      neighbour.direction === "out"
        ? stageEdge(
            `out:${neighbour.stage.id}`,
            stageId,
            neighbour.stage.id,
            neighbour.passage === "sealed",
            offset,
          )
        : stageEdge(
            `in:${neighbour.stage.id}`,
            neighbour.stage.id,
            stageId,
            neighbour.passage === "sealed",
            offset,
          ),
    );
  }

  for (const { actor } of view.actors) {
    edges.push({
      id: `holds:${actor.id}`,
      source: stageId,
      target: actor.id,
      type: "curved",
      data: { axis: "v", offset: 0 },
      sourceHandle: "bottom",
      targetHandle: "top",
      style: { stroke: LINK_STROKE, strokeWidth: 1.2 },
    });
  }

  return { nodes, edges };
}

/** 顺位条上点一行时要知道去哪一层：先找到人，再找他的舞台。 */
export function actorStageId(graph: GameGraph, actorId: string): string | undefined {
  return graph.actors.find((actor) => actor.id === actorId)?.stageId;
}

/** 卡片没开顺位时用来兜底：有舞台就先展开第一个。 */
export function firstStageId(graph: GameGraph): string | undefined {
  return [...graph.stages].sort((left, right) => left.ordinal - right.ordinal)[0]?.id;
}

/** 顺位上有人的舞台优先：展开时落在「现在该看的地方」。 */
export function preferredStageId(graph: GameGraph): string | undefined {
  return queueRows(graph).length > 0 ? nextStageId(graph) : firstStageId(graph);
}
