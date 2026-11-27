import type { GameGraph, GraphActor } from "../../../features/games/useGameGraph";
import type { QueueRow, StageExit, StageView } from "./types";

/**
 * 图谱的读法：把契约里的两张平表拼成「世界 → 舞台 → actor」三层。
 *
 * 只做投影，不做判定：名次只读 `order.entries`，不自己按敏捷重排；谁在场只看 `stageId`。
 * 这些函数都是纯的，所以能在 node 环境里直接断言（后台的页面测试不引 jsdom）。
 */

/** 顺位：名次、已走回合、控制方、是否已死都在服务端算好了。 */
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

/**
 * 这个 actor 还活着吗。
 *
 * 顺位上有权威答案（服务端判的 `alive`），顺位外的人只能看血——两处口径都写在这一个函数里，
 * 免得多一个地方自己判一遍，日后分叉。
 */
export function actorIsAlive(graph: GameGraph, actor: GameGraph["actors"][number]): boolean {
  const entry = graph.order?.entries.find((item) => item.actorId === actor.id);
  return entry?.alive ?? actor.hp > 0;
}

/** 一个舞台此刻的人：活着几个、躺着几个。 */
export type StageCensus = { alive: number; dead: number };

const EMPTY_CENSUS: StageCensus = { alive: 0, dead: 0 };

/**
 * 每个舞台的活人与尸体数；舞台节点用它写一行副标题。
 *
 * 只报合计数，不报「3 人」——一具尸体也是一个 `actor`，混在一起就分不出这地方还有没有活人。
 */
export function stageCensus(graph: GameGraph): Map<string, StageCensus> {
  const counts = new Map<string, StageCensus>();
  for (const actor of graph.actors) {
    const current = counts.get(actor.stageId) ?? EMPTY_CENSUS;
    counts.set(
      actor.stageId,
      actorIsAlive(graph, actor)
        ? { alive: current.alive + 1, dead: current.dead }
        : { alive: current.alive, dead: current.dead + 1 },
    );
  }
  return counts;
}

/** 空舞台就是 `{}`：画第二层时不用到处补默认值。 */
export function censusOf(census: Map<string, StageCensus>, stageId: string): StageCensus {
  return census.get(stageId) ?? EMPTY_CENSUS;
}

/**
 * 副标题的一句话：空、只有活人、活人加尸体。
 *
 * 没有尸体就不写「死 0」——那一格不写出来，正好就是「这里没有死人」的读法。
 */
export function describeCensus(census: StageCensus): string {
  if (census.alive + census.dead === 0) {
    return "空";
  }
  return census.dead === 0 ? `活 ${census.alive}` : `活 ${census.alive} / 死 ${census.dead}`;
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

  // 一张表按邻居收：一条线两个方向落在同一行，不重复名字。
  const exits = new Map<string, StageExit>();
  const exitOf = (other: GameGraph["stages"][number]): StageExit => {
    const existing = exits.get(other.id);
    if (existing !== undefined) {
      return existing;
    }
    const created: StageExit = { stage: other, out: null, in: null };
    exits.set(other.id, created);
    return created;
  };
  for (const connection of graph.connections) {
    if (connection.fromStageId === stageId) {
      const target = graph.stages.find((item) => item.id === connection.toStageId);
      if (target !== undefined) {
        exitOf(target).out = connection.passage;
      }
    }
    if (connection.toStageId === stageId) {
      const source = graph.stages.find((item) => item.id === connection.fromStageId);
      if (source !== undefined) {
        exitOf(source).in = connection.passage;
      }
    }
  }
  const neighbours = [...exits.values()].sort(
    (left, right) => left.stage.ordinal - right.stage.ordinal,
  );

  return { stage, actors, neighbours };
}

/** 一条通路读成一句话：给 `title` 与读屏用，画面上只出现箭头。 */
export function describePassage(exit: StageExit): string {
  const label = (passage: "open" | "sealed" | null): string =>
    passage === null ? "没有路" : passage === "open" ? "能走" : "封着";
  return `与${exit.stage.name}：去${label(exit.out)}，来${label(exit.in)}`;
}

/** 一个 actor 在顺位上的位置；不在顺位上就是 `undefined`。 */
export function actorInQueue(graph: GameGraph, actorId: string): QueueRow | undefined {
  return queueRows(graph).find((row) => row.actorId === actorId);
}

/** actor 的血量比例：血条用，夹在 0..1，避免脏数据把条撑出去。 */
export function hpRatio(actor: Pick<GraphActor, "hp" | "maxHp">): number {
  if (actor.maxHp <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, actor.hp / actor.maxHp));
}
