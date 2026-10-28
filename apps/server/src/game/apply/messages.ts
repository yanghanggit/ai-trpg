import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { gameMessages, games } from "../../db/schema";
import type { Executor, PublicMessage } from "./types";

export async function bumpGameVersion(
  executor: Executor,
  gameId: string,
  now: Date,
): Promise<void> {
  await executor
    .update(games)
    .set({ version: sql<number>`${games.version} + 1`, updatedAt: now })
    .where(eq(games.id, gameId));
}

export async function appendPublicMessage(
  executor: Executor,
  gameId: string,
  sourceActorId: string | null,
  message: PublicMessage,
): Promise<void> {
  const [maxRow] = await executor
    .select({ value: sql<number>`coalesce(max(${gameMessages.sequence}), 0)` })
    .from(gameMessages)
    .where(eq(gameMessages.gameId, gameId));
  const sequence = Number(maxRow?.value ?? 0) + 1;

  await executor.insert(gameMessages).values({
    id: randomUUID(),
    gameId,
    sequence,
    kind: message.kind,
    stageId: message.stageId,
    sourceActorId,
    targetActorId: message.targetActorId ?? null,
    visibility: message.visibility,
    content: message.content,
  });
}
