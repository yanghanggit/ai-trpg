import { and, eq, inArray, or } from "drizzle-orm";
import { stageConnections, stages } from "../../db/schema";
import type { PassageState } from "../kernel/types";
import type { Executor } from "./rows";

/**
 * 把一条已存在、仍封闭的边打开；返回是否真的改动了行。
 *
 * 只改通行状态，不新建边：能连通哪些舞台由内容层声明的边决定，
 * 运行时只能打开自己舞台已有的出边。
 */
export async function openPassage(
  executor: Executor,
  worldId: string,
  fromStageId: string,
  toStageId: string,
): Promise<boolean> {
  const rows = await executor
    .update(stageConnections)
    .set({ passage: "open" })
    .where(
      and(
        eq(stageConnections.worldId, worldId),
        eq(stageConnections.fromStageId, fromStageId),
        eq(stageConnections.toStageId, toStageId),
        eq(stageConnections.passage, "sealed"),
      ),
    )
    .returning({ id: stageConnections.id });
  return rows.length > 0;
}

/** 判断一条已存在的边是否仍处于封闭状态；不存在时返回 false。 */
export async function isPassageSealed(
  executor: Executor,
  worldId: string,
  fromStageId: string,
  toStageId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: stageConnections.id })
    .from(stageConnections)
    .where(
      and(
        eq(stageConnections.worldId, worldId),
        eq(stageConnections.fromStageId, fromStageId),
        eq(stageConnections.toStageId, toStageId),
        eq(stageConnections.passage, "sealed"),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * 从某个舞台「走得到」的舞台名：开着出入边的对面。
 *
 * 这是环境文本唯一被允许点名的舞台集合；`sealed` 边两侧彼此看不见名字，
 * 否则一句环境描写就等于替角色完成了发现。
 */
export async function listOpenNeighborStageNames(
  executor: Executor,
  worldId: string,
  stageId: string,
): Promise<string[]> {
  const rows = await executor
    .select({
      fromStageId: stageConnections.fromStageId,
      toStageId: stageConnections.toStageId,
    })
    .from(stageConnections)
    .where(
      and(
        eq(stageConnections.worldId, worldId),
        eq(stageConnections.passage, "open"),
        or(eq(stageConnections.fromStageId, stageId), eq(stageConnections.toStageId, stageId)),
      ),
    );
  const neighborIds = [
    ...new Set(
      rows.flatMap((row) => [
        ...(row.fromStageId === stageId ? [] : [row.fromStageId]),
        ...(row.toStageId === stageId ? [] : [row.toStageId]),
      ]),
    ),
  ];
  if (neighborIds.length === 0) {
    return [];
  }
  const neighbors = await executor
    .select({ name: stages.name })
    .from(stages)
    .where(inArray(stages.id, neighborIds));
  return neighbors.map((neighbor) => neighbor.name);
}

/** 本 world 的全部边（窄列）：路线回忆只需要端点与通行状态。 */
export async function listConnectionsOfWorld(
  executor: Executor,
  worldId: string,
): Promise<{ fromStageId: string; toStageId: string; passage: PassageState }[]> {
  return executor
    .select({
      fromStageId: stageConnections.fromStageId,
      toStageId: stageConnections.toStageId,
      passage: stageConnections.passage,
    })
    .from(stageConnections)
    .where(eq(stageConnections.worldId, worldId));
}
