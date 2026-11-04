import { and, eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actorControls } from "../db/schema";
import { GameError } from "./errors";
import { getGameMeta, resolveActorIdByName } from "./service";

export type ActorControl = typeof actorControls.$inferSelect;

/** 重复接管是幂等 upsert。 */
export async function takeActorControl(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<ActorControl> {
  // 接管只需要两个 id；不要为此装配整个世界与事件流。
  const game = await getGameMeta(db, gameRef);
  const actor = await resolveActorIdByName(db, game.id, actorRef);

  const [control] = await db
    .insert(actorControls)
    .values({
      actorId: actor.id,
      gameId: game.id,
      playerId: game.playerId,
      controllerType: "player",
    })
    .onConflictDoUpdate({
      target: actorControls.actorId,
      set: {
        gameId: game.id,
        playerId: game.playerId,
        controllerType: "player",
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!control) {
    throw new GameError("invalid_state", `接管 actor 失败: ${actor.name}`);
  }
  return control;
}

export async function releaseActorControl(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<void> {
  const game = await getGameMeta(db, gameRef);
  const actor = await resolveActorIdByName(db, game.id, actorRef);
  await db.delete(actorControls).where(eq(actorControls.actorId, actor.id));
}

export async function isPlayerControlled(
  db: Pick<Database, "select">,
  gameId: string,
  actorId: string,
): Promise<boolean> {
  const [control] = await db
    .select()
    .from(actorControls)
    .where(
      and(
        eq(actorControls.gameId, gameId),
        eq(actorControls.actorId, actorId),
        eq(actorControls.controllerType, "player"),
      ),
    )
    .limit(1);
  return control !== undefined;
}

export async function listPlayerControlledActorIds(
  db: Pick<Database, "select">,
  gameId: string,
): Promise<string[]> {
  const rows = await db
    .select({ actorId: actorControls.actorId })
    .from(actorControls)
    .where(and(eq(actorControls.gameId, gameId), eq(actorControls.controllerType, "player")));
  return rows.map((row) => row.actorId);
}
