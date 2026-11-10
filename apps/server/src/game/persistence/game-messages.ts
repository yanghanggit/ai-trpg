import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { gameMessages } from "../../db/schema";
import type { MessageVisibility } from "../types";
import type { Executor } from "./rows";

/**
 * 公共事件流的写入侧：`game_messages` 是 server→web 的事件通道（上帝视角、带名字），
 * 不是任何 agent 的 memory。读取侧在 `read/game-messages.ts`。
 */

/** 一条公共消息；`kind` 归业务，存储层不枚举。 */
export type PublicMessage = {
  kind: string;
  stageId: string | null;
  targetActorId?: string;
  visibility: MessageVisibility;
  content: string;
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
