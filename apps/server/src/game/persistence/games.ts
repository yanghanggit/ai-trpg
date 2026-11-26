import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/pool";
import { gamePlayers, games, users, worlds } from "../../db/schema";
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

/** 列表里一行局的元信息；不含世界内容，读列表不该装配世界。 */
export type GameListRow = {
  id: string;
  slug: string;
  /** 局主：运维看全库时靠它区分谁是谁的。 */
  ownerId: string;
  ownerUsername: string;
  name: string;
  status: string;
  /** 结束时的结局标签；active 局为空。 */
  outcome: string | null;
  contentVersion: string;
  version: number;
  clock: number;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * 列出局；`ownerId` 省略即全库（只给运维用，判定在调用方）。
 *
 * 只读 `games` 与 `users` 两行；活跃作业、玩家数这类跨表读数由调用方另取，别把它变成大 join。
 */
export async function listGames(
  db: Reader,
  options: { ownerId?: string; status?: string; limit?: number } = {},
): Promise<GameListRow[]> {
  const conditions = [
    options.ownerId === undefined ? undefined : eq(games.ownerId, options.ownerId),
    options.status === undefined ? undefined : eq(games.status, options.status),
  ].filter((condition) => condition !== undefined);

  return db
    .select({
      id: games.id,
      slug: games.slug,
      ownerId: games.ownerId,
      ownerUsername: users.username,
      name: games.name,
      status: games.status,
      outcome: games.outcome,
      contentVersion: games.contentVersion,
      version: games.version,
      clock: games.clock,
      createdAt: games.createdAt,
      updatedAt: games.updatedAt,
    })
    .from(games)
    .innerJoin(users, eq(users.id, games.ownerId))
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(games.updatedAt))
    .limit(options.limit ?? 50);
}

export type GameMeta = {
  id: string;
  slug: string;
  status: string;
  contentVersion: string;
  version: number;
  /** 逻辑时钟：已落账的回合数，0 是开局。 */
  clock: number;
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
    clock: game.clock,
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
 * 删掉一局：一行，其余靠外键级联。
 *
 * 删就是删，不留归档也不软删；与顺位同一个取舍。进程内的轨迹是旁路，
 * 不跟着数据库走。
 */
export async function deleteGameRow(executor: Executor, gameId: string): Promise<boolean> {
  const deleted = await executor
    .delete(games)
    .where(eq(games.id, gameId))
    .returning({ id: games.id });
  return deleted.length > 0;
}

/**
 * 只读版本号：客户端拿它判断自己手上的视图是否过期。
 *
 * 版本号是「这局被写过几次」的计数，不是一个可以自己维护的值——它只由写入事务推进，
 * 所以读出来就是那一刻世界的样子。
 */
export async function readGameVersion(db: Reader, gameId: string): Promise<number> {
  const [row] = await db
    .select({ version: games.version })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!row) {
    throw new GameError("not_found", `游戏不存在: ${gameId}`);
  }
  return row.version;
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

/** 只读逻辑时钟：本局已落账的回合数。 */
export async function readGameClock(db: Reader, gameId: string): Promise<number> {
  const [row] = await db
    .select({ clock: games.clock })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);
  if (!row) {
    throw new GameError("not_found", `游戏不存在: ${gameId}`);
  }
  return row.clock;
}

/**
 * 推进逻辑时钟，返回这一回合所在的那一刻。
 *
 * 只在回合真正落账的写事务里调用，且在写这一回合的记忆之前：同一事务内写下的记忆
 * 随后都落这一刻。被拒的回合不调用——没落账就没有过去一刻。
 */
export async function advanceGameClock(executor: Executor, gameId: string): Promise<number> {
  const [row] = await executor
    .update(games)
    .set({ clock: sql<number>`${games.clock} + 1` })
    .where(eq(games.id, gameId))
    .returning({ clock: games.clock });
  if (!row) {
    throw new GameError("not_found", `游戏不存在: ${gameId}`);
  }
  return row.clock;
}
