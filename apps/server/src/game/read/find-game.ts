import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/pool";
import { games } from "../../db/schema";
import { GameError } from "../errors";

type Reader = Pick<Database, "select">;
type GameRow = typeof games.$inferSelect;

/**
 * slug 打空后决定「还要不要再查一次 id」，不是输入校验。
 *
 * 用形状检查而不是版本正则：Postgres 的 `uuid` 也接受 nil、v6 / v7 / v8，
 * 写死 `[1-5]` 会让合法的 id 静默变成 `not_found`；反过来这里能通过的串，
 * 数据库一定接受，所以不会把格式错误变成 SQL 错误。
 */
const UUID_SHAPE = z.guid();

/** 纯形状判断；导出只为让边界（nil / v7 / 大写）被测试钉住。 */
export function isUuidShaped(ref: string): boolean {
  return UUID_SHAPE.safeParse(ref).success;
}

/** 读取的公共入口：slug 或 UUID 定位一局；slug 跨用户不唯一时要求使用 id。 */
export async function findGame(db: Reader, ref: string): Promise<GameRow | undefined> {
  const bySlug = await db.select().from(games).where(eq(games.slug, ref)).limit(2);
  if (bySlug.length > 1) {
    throw new GameError("invalid_action", `游戏 slug 不唯一，请使用 id: ${ref}`);
  }
  if (bySlug[0]) {
    return bySlug[0];
  }
  if (!isUuidShaped(ref)) {
    return undefined;
  }
  const byId = await db.select().from(games).where(eq(games.id, ref)).limit(1);
  return byId[0];
}
