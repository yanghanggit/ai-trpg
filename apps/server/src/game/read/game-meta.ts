import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actors, gamePlayers, stages, worlds } from "../../db/schema";
import { GameError } from "../errors";
import { findGame } from "./find-game";

export type GameMeta = {
  id: string;
  slug: string;
  status: string;
  contentVersion: string;
  version: number;
  playerId: string;
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
  return {
    id: game.id,
    slug: game.slug,
    status: game.status,
    contentVersion: game.contentVersion,
    version: game.version,
    playerId: playerRow.id,
  };
}

/**
 * 按 actor 真名解析 id 与所在场景；不装配 world。
 *
 * 语义与 `findActorByName` 一致：名字重复直接拒绝，不退回 id 或编号。
 */
export async function resolveActorIdByName(
  db: Database,
  gameId: string,
  name: string,
): Promise<{ id: string; name: string; stageId: string; seq: number }> {
  const rows = await db
    .select({ id: actors.id, name: actors.name, stageId: actors.stageId, seq: actors.seq })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .innerJoin(worlds, eq(stages.worldId, worlds.id))
    .where(and(eq(worlds.gameId, gameId), eq(actors.name, name)))
    .limit(2);
  if (rows.length === 0) {
    throw new GameError("not_found", `actor 不存在: ${name}`);
  }
  if (rows.length > 1) {
    throw new GameError("invalid_action", `actor 名称不唯一: ${name}`);
  }
  const [row] = rows;
  assert(row, `actor 定位结果为空: ${name}`);
  return row;
}

/** 创建一局游戏及初始 world、stage、actor、item 与 memory。 */
