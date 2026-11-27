import dagre from "@dagrejs/dagre";

/**
 * 两张图的坐标：都是纯函数，同一份输入永远算出同一张图。
 *
 * 坐标不存进契约、也不存进状态：它只取决于拓扑与顺序。确定性是刻意的——
 * 自动刷新每 5 秒重读一次，随机布局会让节点每次都跳。
 */

export const STAGE_NODE = { width: 176, height: 68 };
export const ACTOR_NODE = { width: 216, height: 62 };

const COLUMN_GAP = 28;
const ROW_GAP = 22;

export type Position = { x: number; y: number };
export type LayoutEdge = { from: string; to: string };

/**
 * 世界图：舞台是有向边、可以成环，交给 dagre 分层。
 *
 * 调用方先把舞台按 `ordinal` 排好再传进来：dagre 会参考插入顺序，输入一致布局才一致。
 */
export function layoutStages(
  stageIds: readonly string[],
  edges: readonly LayoutEdge[],
  options: { rankdir?: "LR" | "TB" } = {},
): Map<string, Position> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: options.rankdir ?? "LR",
    nodesep: 32,
    ranksep: 80,
    marginx: 12,
    marginy: 12,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const id of stageIds) {
    graph.setNode(id, { width: STAGE_NODE.width, height: STAGE_NODE.height });
  }

  const drawn = new Set<string>();
  for (const edge of edges) {
    if (edge.from === edge.to) {
      continue;
    }
    // dagre 的图是非多重图：同一对舞台只放一条边，重复边会让它报错。
    const key = `${edge.from}->${edge.to}`;
    if (drawn.has(key) || !graph.hasNode(edge.from) || !graph.hasNode(edge.to)) {
      continue;
    }
    drawn.add(key);
    graph.setEdge(edge.from, edge.to);
  }

  dagre.layout(graph);

  const positions = new Map<string, Position>();
  for (const id of stageIds) {
    const node = graph.node(id) as { x: number; y: number } | undefined;
    if (node === undefined) {
      continue;
    }
    // dagre 给的是中心点，xyflow 要左上角。
    positions.set(id, {
      x: node.x - STAGE_NODE.width / 2,
      y: node.y - STAGE_NODE.height / 2,
    });
  }
  return positions;
}

/**
 * 舞台内部：根在上，actor 按顺位名次从上往下排，排满一列接下一列。
 *
 * 不按舞台名字母序、也不按血量：这一层的顺序就是顺位本身，换列只是为了让长名单不摊成一列。
 */
export function layoutStageActors(
  actorIds: readonly string[],
  options: { perColumn?: number; rootWidth?: number; rootHeight?: number } = {},
): Map<string, Position> {
  const perColumn = Math.max(1, options.perColumn ?? 8);
  const rootWidth = options.rootWidth ?? STAGE_NODE.width;
  const rootHeight = options.rootHeight ?? STAGE_NODE.height;

  const columns = Math.max(1, Math.ceil(actorIds.length / perColumn));
  const totalWidth = columns * ACTOR_NODE.width + (columns - 1) * COLUMN_GAP;
  const startX = (rootWidth - totalWidth) / 2;

  const positions = new Map<string, Position>();
  actorIds.forEach((id, index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    positions.set(id, {
      x: startX + column * (ACTOR_NODE.width + COLUMN_GAP),
      y: rootHeight + ROW_GAP + row * (ACTOR_NODE.height + ROW_GAP),
    });
  });
  return positions;
}
