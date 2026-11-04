import { and, asc, eq, gt, max } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { gameMessages } from "../../db/schema";
import type { MessageState, MessageVisibility } from "../types";

export type GameMessageQuery = {
  /** 只取序号大于它的消息；用于增量推进。 */
  afterSequence?: number;
  /** 单次上限，按 `sequence` 升序取前 N 条。 */
  limit?: number;
};

/**
 * 公共事件流；按 `sequence` 升序，可选择增量与条数上限。
 *
 * 控制面才需要它：快照、事件回顾、按游标增量拉。判定路径读 `getGameStateSlice`。
 */
export async function listGameMessages(
  db: Database,
  gameId: string,
  query: GameMessageQuery = {},
): Promise<MessageState[]> {
  const conditions = [eq(gameMessages.gameId, gameId)];
  if (query.afterSequence !== undefined) {
    conditions.push(gt(gameMessages.sequence, query.afterSequence));
  }
  const select = db
    .select()
    .from(gameMessages)
    .where(and(...conditions))
    .orderBy(asc(gameMessages.sequence));
  const rows = query.limit === undefined ? await select : await select.limit(query.limit);
  return rows.map((message) => ({
    id: message.id,
    sequence: message.sequence,
    kind: message.kind,
    stageId: message.stageId,
    sourceActorId: message.sourceActorId,
    targetActorId: message.targetActorId,
    visibility: message.visibility as MessageVisibility,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  }));
}

/** 公共事件流当前的最大 `sequence`；空事件流为 0。 */
export async function latestMessageSequence(db: Database, gameId: string): Promise<number> {
  const [row] = await db
    .select({ sequence: max(gameMessages.sequence) })
    .from(gameMessages)
    .where(eq(gameMessages.gameId, gameId));
  // `max()` 在空表上返回 null，这里不是错误：只是还没有任何公共事件。
  return row?.sequence ?? 0;
}
