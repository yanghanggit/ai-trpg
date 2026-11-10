import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { actorControls } from "../../db/schema";
import { GameError } from "../errors";
import { resolveActorByNameInWorld } from "./actors";
import { getGameMeta } from "./games";

/**
 * 接管关系（`actor_controls`）的具名读写：谁替这个 actor 决定回合。
 *
 * 控制者不是 actor 的属性，而是座位与 actor 的绑定——接管不改变身份、场景、物品或 memory，
 * 释放后原地继续，所以这张表独立于 actor 本体。
 *
 * 两侧的入参形状不同，是刻意的：写侧面对外部入口（CLI / web 只给 slug 与名字），
 * 自己解析 id；读侧由引擎在回合判定里调用，手上已经是 id，不再多查一次名字。
 */

export type ActorControlRow = typeof actorControls.$inferSelect;

/** 外部入口的定位：一局 + 一个 actor，换成写入需要的三个 id。 */
async function resolveControlTarget(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<{ gameId: string; playerId: string; actor: { id: string; name: string } }> {
  // 接管只需要几个 id；不要为此装配整个世界与事件流。
  const game = await getGameMeta(db, gameRef);
  const { actor } = await resolveActorByNameInWorld(db, game.worldId, actorRef);
  return { gameId: game.id, playerId: game.playerId, actor };
}

/** 重复接管是幂等 upsert。 */
export async function takeActorControl(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<ActorControlRow> {
  const { gameId, playerId, actor } = await resolveControlTarget(db, gameRef, actorRef);

  const [control] = await db
    .insert(actorControls)
    .values({
      actorId: actor.id,
      gameId,
      playerId,
      controllerType: "player",
    })
    .onConflictDoUpdate({
      target: actorControls.actorId,
      set: {
        gameId,
        playerId,
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

/** 释放接管：删掉绑定即回到 agent 控制，下一次回合由 actor 自己决定。 */
export async function releaseActorControl(
  db: Database,
  gameRef: string,
  actorRef: string,
): Promise<void> {
  const { actor } = await resolveControlTarget(db, gameRef, actorRef);
  await db.delete(actorControls).where(eq(actorControls.actorId, actor.id));
}

/** 这个 actor 的回合是否该由玩家决定。 */
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

/** 一局里全部由玩家决定的 actor；推进回合时用来跳过它们的 agent 回合。 */
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
