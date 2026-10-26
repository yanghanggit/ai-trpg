import { and, eq } from "drizzle-orm";
import { stageConnections } from "../../db/schema";
import type { Executor } from "../apply/types";

/**
 * 把一条已存在、仍封闭的边打开；返回是否真的改动了行。
 *
 * 只改通行状态，不新建边：能连通哪些场景由内容层声明的边决定，
 * 运行时只能打开自己场景已有的出边。
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
