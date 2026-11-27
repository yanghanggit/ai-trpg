import type { GameGraph, GraphActor } from "../../../features/games/useGameGraph";
import type { EntityRef, QueueRow, StageView } from "./types";

/**
 * 图谱的读法：把契约里的两张平表拼成「世界 → 舞台 → actor」三层。
 *
 * 只做投影，不做判定：名次只读 `order.entries`，不自己按敏捷重排；谁在场只看 `stageId`。
 * 这些函数都是纯的，所以能在 node 环境里直接断言（后台的页面测试不引 jsdom）。
 */

/** 顺位条：名次、已走回合、控制方、是否已死都在服务端算好了。 */
export function queueRows(graph: GameGraph): QueueRow[] {
  const nextActorId = graph.order?.nextActor?.actorId;
  return [...(graph.order?.entries ?? [])]
    .sort((left, right) => left.position - right.position)
    .map((entry) => ({
      actorId: entry.actorId,
      name: entry.actorName,
      position: entry.position,
      turnsTaken: entry.turnsTaken,
      control: entry.control,
      alive: entry.alive,
      isNext: entry.actorId === nextActorId,
    }));
}

/** 两个舞台之间的连通：一条线代表一对舞台，方向表里装一到两条。 */
export type ConnectionPair = {
  /** 稳定的边 id：两个舞台 id 排序后拼起来，刷新不会换。 */
  id: string;
  /** 画线的两端，按 id 排序：`[起点侧, 终点侧]`，与方向无关。 */
  stageIds: [string, string];
  directions: { from: string; to: string; passage: "open" | "sealed" }[];
  /** 至少一个方向能走。封着的方向仍是连线，只是过不去。 */
  passable: boolean;
};

/**
 * 把逐方向的边折成「一对舞台一条线」。
 *
 * 内容层里双向通行是两条边，画布上却不需要两条曲线：一条线 + 两端各一个箭头，
 * 就同时表达了「几个方向」与「各自通不通」。自环（同一舞台连自己）不画。
 */
export function connectionPairs(graph: GameGraph): ConnectionPair[] {
  const pairs = new Map<string, ConnectionPair>();
  for (const connection of graph.connections) {
    const [left, right] = [connection.fromStageId, connection.toStageId].sort() as [string, string];
    if (left === right) {
      continue;
    }
    const id = `${left}~${right}`;
    const pair = pairs.get(id) ?? { id, stageIds: [left, right], directions: [], passable: false };
    pair.directions.push({
      from: connection.fromStageId,
      to: connection.toStageId,
      passage: connection.passage,
    });
    pair.passable = pair.passable || connection.passage === "open";
    pairs.set(id, pair);
  }
  // 顺序稳定：先按两端的 id 排，刷新前后同一条线留在原地。
  return [...pairs.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** 每个舞台里有几个人；舞台节点用它写一行副标题。 */
export function stagePeople(graph: GameGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const actor of graph.actors) {
    counts.set(actor.stageId, (counts.get(actor.stageId) ?? 0) + 1);
  }
  return counts;
}

/** 顺位上的下一个人站在哪个舞台：世界图上高亮它，回答「轮到谁、在哪儿」。 */
export function nextStageId(graph: GameGraph): string | undefined {
  const actorId = graph.order?.nextActor?.actorId;
  if (actorId === undefined) {
    return undefined;
  }
  return graph.actors.find((actor) => actor.id === actorId)?.stageId;
}

/**
 * 舞台第二层：根是舞台，actor 按顺位名次排；不在顺位上的人（顺位没开、或顺位开出后才到场）
 * 按实体序号接在后面——顺序必须确定，否则每次刷新节点会跳。
 */
export function stageView(graph: GameGraph, stageId: string): StageView | undefined {
  const stage = graph.stages.find((item) => item.id === stageId);
  if (stage === undefined) {
    return undefined;
  }

  const rows = new Map(queueRows(graph).map((row) => [row.actorId, row]));
  const actors = graph.actors
    .filter((actor) => actor.stageId === stageId)
    .map((actor) => ({ actor, entry: rows.get(actor.id) }))
    .sort((left, right) => {
      const leftPosition = left.entry?.position ?? Number.POSITIVE_INFINITY;
      const rightPosition = right.entry?.position ?? Number.POSITIVE_INFINITY;
      return leftPosition === rightPosition
        ? left.actor.seq - right.actor.seq
        : leftPosition - rightPosition;
    });

  const neighbours: StageView["neighbours"] = [];
  for (const connection of graph.connections) {
    if (connection.fromStageId === stageId) {
      const target = graph.stages.find((item) => item.id === connection.toStageId);
      if (target !== undefined) {
        neighbours.push({ stage: target, passage: connection.passage, direction: "out" });
      }
    }
    if (connection.toStageId === stageId) {
      const source = graph.stages.find((item) => item.id === connection.fromStageId);
      if (source !== undefined) {
        neighbours.push({ stage: source, passage: connection.passage, direction: "in" });
      }
    }
  }
  neighbours.sort((left, right) => left.stage.ordinal - right.stage.ordinal);

  return { stage, actors, neighbours };
}

/** 一个 actor 在顺位上的位置；不在顺位上就是 `undefined`。 */
export function actorInQueue(graph: GameGraph, actorId: string): QueueRow | undefined {
  return queueRows(graph).find((row) => row.actorId === actorId);
}

/**
 * 检索索引：舞台、actor、道具都归一成 `kind / id / label`。
 *
 * 现在只喂给未来的搜索框，但形状先定下来——三层各自造一套搜索结果，迟早要拆。
 */
export function entityIndex(graph: GameGraph): EntityRef[] {
  const entries: EntityRef[] = [];

  for (const stage of graph.stages) {
    entries.push({
      kind: "stage",
      id: stage.id,
      label: stage.name,
      stageId: stage.id,
      keywords: [stage.key, stage.environment].join(" "),
    });
    for (const anchor of stage.anchors) {
      for (const item of anchor.items) {
        entries.push(itemRef(item, stage.id, undefined, anchor.label));
      }
    }
  }

  for (const actor of graph.actors) {
    entries.push({
      kind: "actor",
      id: actor.id,
      label: actor.name,
      stageId: actor.stageId,
      keywords: [actor.key, text(actor.appearance, "text")].join(" "),
    });
    for (const item of actor.items) {
      entries.push(itemRef(item, actor.stageId, actor.id));
    }
  }

  return entries;
}

/** 原始行里可能缺字段：读不到就当没有，不抛。 */
function text(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  return typeof value === "string" ? value : "";
}

function itemRef(
  item: Record<string, unknown>,
  stageId: string,
  actorId: string | undefined,
  anchorLabel?: string,
): EntityRef {
  const label = text(item, "name");
  const id = text(item, "id") || text(item, "key") || label;
  return {
    kind: "item",
    id,
    label,
    stageId,
    ...(actorId === undefined ? {} : { actorId }),
    keywords: [text(item, "description"), anchorLabel ?? ""].join(" "),
  };
}

/** actor 的血量比例：血条用，夹在 0..1，避免脏数据把条撑出去。 */
export function hpRatio(actor: Pick<GraphActor, "hp" | "maxHp">): number {
  if (actor.maxHp <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, actor.hp / actor.maxHp));
}
