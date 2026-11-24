/**
 * 行动顺位的四件事：开一张、读当前、完成、移除。
 *
 * 都只动这一张台账，不推进任何回合：顺位回答「谁在这张单上、已经推了几轮」，不回答
 * 「下一个该推谁」。点名推进仍归 `npc`，本文件不代选目标，也不改顺位顺序。
 */

import type { Database } from "../db/pool";
import {
  type ActionOrderState,
  completeActionOrder,
  getGameMeta,
  getGameStateSlice,
  openActionOrder,
  readActionOrder,
  removeActionOrder,
} from "../game";

export async function createActionOrderOp(
  db: Database,
  gameRef: string,
): Promise<{ order: ActionOrderState }> {
  const state = await getGameStateSlice(db, gameRef);
  return { order: await openActionOrder(db, state) };
}

/** 不给 id 就读当前进行中的那张；没有就回 `null`，不是错误。 */
export async function readActionOrderOp(
  db: Database,
  gameRef: string,
  orderId?: string,
): Promise<{ order: ActionOrderState | null }> {
  const game = await getGameMeta(db, gameRef);
  return { order: await readActionOrder(db, game.id, orderId) };
}

export async function completeActionOrderOp(
  db: Database,
  gameRef: string,
  orderId: string,
): Promise<{ order: ActionOrderState }> {
  const game = await getGameMeta(db, gameRef);
  return { order: await completeActionOrder(db, game.id, orderId) };
}

export async function removeActionOrderOp(
  db: Database,
  gameRef: string,
  orderId: string,
): Promise<{ removed: string }> {
  const game = await getGameMeta(db, gameRef);
  return removeActionOrder(db, game.id, orderId);
}
