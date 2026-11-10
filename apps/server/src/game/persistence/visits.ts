import { randomUUID } from "node:crypto";
import { stageVisits } from "../../db/schema";
import type { Executor } from "./rows";

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
