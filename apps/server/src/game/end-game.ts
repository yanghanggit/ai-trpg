import { eq } from "drizzle-orm";
import { games } from "../db/schema";
import { appendPublicMessage } from "./apply/messages";
import type { Executor } from "./apply/types";

export type CompleteGameOptions = {
  now?: Date;
  stageId?: string | null;
};

/**
 * 把一局游戏置为 completed，并写一条公共结束事件。
 *
 * world 的 end_game 与默认玩家角色死亡都复用这里；调用方决定结束文案与
 * 可选场景。已经结束的游戏不会重复写事件。
 */
export async function completeGame(
  executor: Executor,
  gameId: string,
  message: string,
  options: CompleteGameOptions = {},
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

  const now = options.now ?? new Date();
  await executor
    .update(games)
    .set({ status: "completed", updatedAt: now })
    .where(eq(games.id, gameId));
  await appendPublicMessage(executor, gameId, null, {
    kind: "game_completed",
    stageId: options.stageId ?? null,
    visibility: "stage",
    content: message,
  });
  return true;
}
