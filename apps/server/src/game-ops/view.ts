/**
 * 观看者投影（客户端读模型）的读入口。
 *
 * `game/client-view` 定义了形状，这里只回答「看谁」：不指定 actor 时就是玩家操控的那个角色。
 * 客户端不读活状态，也不需要知道上帝视角下别人叫什么——所以它只走这一条读路径。
 */

import type { Database } from "../db/pool";
import { defaultPlayerActor, findActorByRef } from "../game/actor-state";
import { type ActorView, getActorView } from "../game/client-view";
import { GameError } from "../game/errors";
import { getGameStateSlice } from "../game/game-state";
import type { GameStateSlice } from "../game/kernel/types";

/**
 * 一局对某个观看者的投影；不传 `actor` 时用默认玩家角色。
 *
 * 内容层可以不标主角，那时没有默认观看者，只能显式指定——这是内容问题，不是权限问题。
 */
export async function readActorView(
  db: Database,
  gameRef: string,
  actorRef?: string,
): Promise<{ view: ActorView }> {
  const state: GameStateSlice = await getGameStateSlice(db, gameRef);
  const actor =
    actorRef === undefined
      ? (defaultPlayerActor(state)?.actor ?? noPlayerActor(gameRef))
      : findActorByRef(state, actorRef);
  return { view: await getActorView(db, gameRef, actor.name, state) };
}

function noPlayerActor(gameRef: string): never {
  throw new GameError(
    "invalid_state",
    `这一局没有默认玩家角色，读取投影需要显式指定 actor: ${gameRef}`,
  );
}
