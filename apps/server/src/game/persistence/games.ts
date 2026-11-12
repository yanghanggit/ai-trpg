import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/pool";
import { gamePlayers, games, worlds } from "../../db/schema";
import { GameError } from "../errors";
import type { Executor } from "./rows";

/**
 * game 行的读写：定位、窄读元信息、行锁、版本号与生命周期。
 *
 * 一局 ⇄ 一个 world（`worlds_game_unique`），所以 `worldId` 是这局的控制面身份之一；
 * 名字类定位仍按 world 作用域，见 `persistence/actors.ts`。
 */

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
  // 多取一行：slug 只按 owner 唯一，跨用户可能重名，重名时要求调用方改用 id。
  const slugMatches = await db.select().from(games).where(eq(games.slug, ref)).limit(2);
  if (slugMatches.length > 1) {
    throw new GameError("invalid_action", `游戏 slug 不唯一，请使用 id: ${ref}`);
  }
  if (slugMatches[0]) {
    return slugMatches[0];
  }
  if (!isUuidShaped(ref)) {
    return undefined;
  }
  const byId = await db.select().from(games).where(eq(games.id, ref)).limit(1);
  return byId[0];
}

export type GameMeta = {
  id: string;
  slug: string;
  status: string;
  contentVersion: string;
  version: number;
  playerId: string;
  /** 这局的 world id；按名字定位 actor / stage 时用它做作用域。 */
  worldId: string;
};

/** 只读游戏与玩家 id 的最小信息；给控制类调用方用，不装配世界。 */
export async function getGameMeta(db: Database, ref: string): Promise<GameMeta> {
  const game = await findGame(db, ref);
  if (!game) {
    throw new GameError("not_found", `游戏不存在: ${ref}`);
  }
  const [playerRow] = await db
    .select({ id: gamePlayers.id })
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, game.id))
    .limit(1);
  if (!playerRow) {
    throw new GameError("invalid_state", `游戏缺少 player: ${game.id}`);
  }
  const [worldRow] = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.gameId, game.id))
    .limit(1);
  if (!worldRow) {
    throw new GameError("invalid_state", `游戏缺少 world: ${game.id}`);
  }
  return {
    id: game.id,
    slug: game.slug,
    status: game.status,
    contentVersion: game.contentVersion,
    version: game.version,
    playerId: playerRow.id,
    worldId: worldRow.id,
  };
}

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

/**
 * 递增 game version：一个写入事务推一次，客户端据此判断状态有没有变过。
 *
 * 它不是并发控制：同一局的写入由 `games` 行锁串行化。
 */
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
