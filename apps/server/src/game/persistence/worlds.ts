import { eq } from "drizzle-orm";
import { worlds } from "../../db/schema";
import type { Executor, WorldRow } from "../apply/types";

/** 读一局游戏对应的 world 行。 */
export async function loadWorldByGame(
  executor: Executor,
  gameId: string,
): Promise<WorldRow | undefined> {
  const [world] = await executor.select().from(worlds).where(eq(worlds.gameId, gameId)).limit(1);
  return world;
}
