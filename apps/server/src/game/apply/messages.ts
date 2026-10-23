import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { gameMessages, games } from "../../db/schema";
import type { Executor, PublicMessage } from "./types";

/** 递增 game 版本；每个成功动作都调用一次。 */
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

/** 追加一条公共事件并自动分配 sequence。 */
export async function appendPublicMessage(
  executor: Executor,
  gameId: string,
  actorId: string | null,
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
    speakerActorId: actorId,
    targetActorId: message.targetActorId ?? null,
    visibility: message.visibility,
    content: message.content,
  });
}

/** 渲染本次技能选用的物品。 */
export function itemListText(items: readonly { name: string }[]): string {
  return items.length > 0 ? `（使用${items.map((item) => item.name).join("、")}）` : "";
}
