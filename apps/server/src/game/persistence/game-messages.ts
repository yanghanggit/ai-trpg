import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, max, sql } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { gameMessages } from "../../db/schema";
import type { MessageState, MessageVisibility } from "../types";
import type { Executor } from "./rows";

/**
 * 公共事件流（`game_messages`）的读写。
 *
 * 它是 server→web 的事件通道（上帝视角、带名字），不是任何 agent 的 memory。判定路径
 * 读整局状态，不读事件流；只有控制面（快照、事件回顾、按游标增量拉）才需要这里的读。
 */

/** 一条公共消息；`kind` 归业务，存储层不枚举。 */
export type PublicMessage = {
  kind: string;
  stageId: string | null;
  targetActorId?: string;
  visibility: MessageVisibility;
  content: string;
};

export type GameMessageQuery = {
  /** 只取序号大于它的消息；用于增量推进。 */
  afterSequence?: number;
  /** 单次上限，按 `sequence` 升序取前 N 条。 */
  limit?: number;
};

/**
 * 追加一条公共消息，序号取当前最大值 + 1。
 *
 * 同一局的写入由调用方串行化（回合持有 game 行锁）；这里不做重试，冲突显式失败。
 */
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

/** 公共事件流；按 `sequence` 升序，可选择增量与条数上限。 */
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

/** 公共事件流当前的最大 `sequence`；空事件流为 0（不是错误，只是还没有任何公共事件）。 */
export async function latestMessageSequence(db: Database, gameId: string): Promise<number> {
  const [row] = await db
    .select({ sequence: max(gameMessages.sequence) })
    .from(gameMessages)
    .where(eq(gameMessages.gameId, gameId));
  return row?.sequence ?? 0;
}
