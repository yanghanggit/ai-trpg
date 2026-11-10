import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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

/** 本 actor 去过的场景 id；路线回忆据此决定链上写名字还是 `#序号`。 */
export async function listVisitedStageIds(
  executor: Executor,
  gameId: string,
  actorId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ stageId: stageVisits.stageId })
    .from(stageVisits)
    .where(and(eq(stageVisits.gameId, gameId), eq(stageVisits.actorId, actorId)));
  return rows.map((row) => row.stageId);
}
