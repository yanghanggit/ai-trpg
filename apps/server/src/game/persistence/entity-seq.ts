import { eq, sql } from "drizzle-orm";
import { games } from "../../db/schema";
import type { Executor } from "../apply/types";
import { GameError } from "../errors";

/**
 * 每局实体序号：world / stage / actor / item 共用一条递增序列。
 *
 * 只服务于确定性排序；身份与引用仍然用 UUID。计数在 `games` 行上，
 * 同一事务内串行取号，跨局互不影响。
 */
export async function allocateEntitySeq(executor: Executor, gameId: string): Promise<number> {
  const [row] = await executor
    .update(games)
    .set({ entitySeq: sql`${games.entitySeq} + 1` })
    .where(eq(games.id, gameId))
    .returning({ seq: games.entitySeq });
  if (row === undefined) {
    throw new GameError("invalid_state", `游戏不存在，无法分配实体序号: ${gameId}`);
  }
  return row.seq;
}
