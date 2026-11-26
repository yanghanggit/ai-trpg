/**
 * 建局物化的原始数据：这一局从内容模板一次性写下的那些行。
 *
 * 只取「建局时写进去的东西」——world、stage、stage 之间的通路、actor 与它的形态、道具、
 * 玩家归属。运行时状态（clock、version、消息、记忆、作业）不在这里：它每天都在长，
 * 不适合当一份可以通读的原文。
 *
 * 行原样给出，不做字段挑选、不做形状转换：这是给人对照数据库用的，翻译一层就少一层可信。
 */

import { eq, inArray } from "drizzle-orm";
import type { Database } from "../db/pool";
import {
  actorSignatureNames,
  actorSignatures,
  actors,
  gamePlayers,
  games,
  items,
  stageConnections,
  stageItems,
  stages,
  worlds,
} from "../db/schema";
import { GameError } from "../game/errors";
import { findGame } from "../game/persistence/games";

/** 一局建局数据的原文；数组按 id 顺序返回，缺表就是空数组。 */
export type GameBuildData = {
  game: Record<string, unknown> | null;
  world: Record<string, unknown> | null;
  stages: Record<string, unknown>[];
  stageConnections: Record<string, unknown>[];
  actors: Record<string, unknown>[];
  actorSignatures: Record<string, unknown>[];
  actorSignatureNames: Record<string, unknown>[];
  items: Record<string, unknown>[];
  stageItems: Record<string, unknown>[];
  gamePlayers: Record<string, unknown>[];
};

export async function buildDataOp(db: Database, gameRef: string): Promise<GameBuildData> {
  const found = await findGame(db, gameRef);
  if (!found) {
    throw new GameError("not_found", `游戏不存在: ${gameRef}`);
  }

  const [game] = await db.select().from(games).where(eq(games.id, found.id)).limit(1);
  const [world] = await db.select().from(worlds).where(eq(worlds.gameId, found.id)).limit(1);

  // 没有 world 行说明这局建到一半：其余集合都空着回，不在这里报错。
  const stageRows =
    world === undefined ? [] : await db.select().from(stages).where(eq(stages.worldId, world.id));
  const stageIds = stageRows.map((stage) => stage.id);
  const connections =
    world === undefined
      ? []
      : await db.select().from(stageConnections).where(eq(stageConnections.worldId, world.id));

  const actorRows =
    stageIds.length === 0
      ? []
      : await db.select().from(actors).where(inArray(actors.stageId, stageIds));
  const actorIds = actorRows.map((actor) => actor.id);

  const signatureRows =
    actorIds.length === 0
      ? []
      : await db.select().from(actorSignatures).where(inArray(actorSignatures.actorId, actorIds));
  const itemRows =
    actorIds.length === 0
      ? []
      : await db.select().from(items).where(inArray(items.actorId, actorIds));
  const stageItemRows =
    stageIds.length === 0
      ? []
      : await db.select().from(stageItems).where(inArray(stageItems.stageId, stageIds));

  return {
    game: (game as Record<string, unknown> | undefined) ?? null,
    world: (world as Record<string, unknown> | undefined) ?? null,
    stages: stageRows as Record<string, unknown>[],
    stageConnections: connections as Record<string, unknown>[],
    actors: actorRows as Record<string, unknown>[],
    actorSignatures: signatureRows as Record<string, unknown>[],
    actorSignatureNames: (await db
      .select()
      .from(actorSignatureNames)
      .where(eq(actorSignatureNames.gameId, found.id))) as Record<string, unknown>[],
    items: itemRows as Record<string, unknown>[],
    stageItems: stageItemRows as Record<string, unknown>[],
    gamePlayers: (await db
      .select()
      .from(gamePlayers)
      .where(eq(gamePlayers.gameId, found.id))) as Record<string, unknown>[],
  };
}
