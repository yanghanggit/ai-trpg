import { and, eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actorControls } from "../db/schema";
import { findActor } from "./actors";
import { GameError } from "./errors";
import { getGameState } from "./service";

export type ActorControl = typeof actorControls.$inferSelect;

/**
 * 把 actor 的控制权交给当前玩家；重复接管是幂等 upsert。
 */
export async function takeActorControl(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<ActorControl> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);

  const [control] = await db
    .insert(actorControls)
    .values({
      actorId: actor.id,
      gameId: state.game.id,
      playerId: state.player.id,
      controllerType: "player",
    })
    .onConflictDoUpdate({
      target: actorControls.actorId,
      set: {
        gameId: state.game.id,
        playerId: state.player.id,
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

/** 释放 actor 的玩家控制关系。 */
export async function releaseActorControl(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<void> {
  const state = await getGameState(db, gameRef);
  const actor = findActor(state, actorRef);
  await db.delete(actorControls).where(eq(actorControls.actorId, actor.id));
}

/** 判断 actor 当前是否由玩家控制。 */
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

/** 返回本局中由玩家控制的 actor id。 */
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
