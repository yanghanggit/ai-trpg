/**
 * 行动顺位的四件事：开一条、读当前、完成、移除。
 *
 * 都只动这条顺位，不推进任何回合：顺位回答「谁在顺位上、各自推过几个回合」，不回答
 * 「下一个该推谁」。点名推进仍归 `npc`，本文件不代选目标，也不改顺位顺序。
 */

import type { Database } from "../db/pool";
import {
  type ActionOrderRoundState,
  type ActionOrderState,
  completeActionOrder,
  getGameMeta,
  getGameStateSlice,
  openActionOrder,
  readActionOrder,
  readActionOrderRound,
  removeActionOrder,
} from "../game";

export async function createActionOrderOp(
  db: Database,
  gameRef: string,
): Promise<{ order: ActionOrderState }> {
  const state = await getGameStateSlice(db, gameRef);
  return { order: await openActionOrder(db, state) };
}

/**
 * 不给 id 就读当前进行中的那张；没有就回 `null`，不是错误。
 *
 * 顺位与行动轮并列返回：一个回答「谁排第几、该谁了」，一个回答「这一轮推到哪了」。
 * 两者不互相嵌套——账不是顺位的一部分，硬塞进去会让两个名字都变糊。
 */
export async function readActionOrderOp(
  db: Database,
  gameRef: string,
  orderId?: string,
): Promise<{ order: ActionOrderState | null; round: ActionOrderRoundState | null }> {
  const game = await getGameMeta(db, gameRef);
  const order = await readActionOrder(db, game.id, orderId);
  return {
    order,
    round: order === null ? null : await readActionOrderRound(db, order.id),
  };
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
