import { eq } from "drizzle-orm";
import { games } from "../../db/schema";
import type { Executor } from "../apply/types";

/** 以行锁读取游戏行：结算类事务用它把同一局的写入串行化。 */
export async function lockGameRow(
  executor: Executor,
  gameId: string,
): Promise<{ id: string; status: string } | undefined> {
  const [game] = await executor
    .select({ id: games.id, status: games.status })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)
    .for("update");
  return game;
}

/**
 * 游戏生命周期的写操作。
 *
 * 返回「这次调用是否真的改了状态」，调用方据此决定要不要写结束事件。
 */
export async function completeGameIfActive(
  executor: Executor,
  gameId: string,
  now: Date,
  outcome: string,
): Promise<boolean> {
  const [game] = await executor
    .select({ status: games.status })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!game) {
    throw new Error(`游戏不存在: ${gameId}`);
  }
  if (game.status === "completed") {
    return false;
  }
  await executor
    .update(games)
    .set({ status: "completed", outcome, updatedAt: now })
    .where(eq(games.id, gameId));
  return true;
}
