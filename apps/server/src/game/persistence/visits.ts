import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { stageVisits } from "../../db/schema";
import type { Executor } from "../apply/types";

/** 记录一次到达；重复到达只更新 last_visited_at。 */
export async function recordStageVisit(
  executor: Executor,
  gameId: string,
  actorId: string,
  stageId: string,
  now: Date = new Date(),
): Promise<void> {
  await executor
    .insert(stageVisits)
    .values({
      id: randomUUID(),
      gameId,
      actorId,
      stageId,
      firstVisitedAt: now,
      lastVisitedAt: now,
    })
    .onConflictDoUpdate({
      target: [stageVisits.actorId, stageVisits.stageId],
      set: { lastVisitedAt: now },
    });
}

export async function hasStageVisit(
  executor: Executor,
  actorId: string,
  stageId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: stageVisits.id })
    .from(stageVisits)
    .where(and(eq(stageVisits.actorId, actorId), eq(stageVisits.stageId, stageId)))
    .limit(1);
  return row !== undefined;
}
