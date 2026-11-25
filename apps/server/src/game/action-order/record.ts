import type { Database } from "../../db/pool";
import { findActiveActionOrder, incrementActionOrderEntry } from "../persistence/action-orders";

/**
 * 记一次推进：这个 actor 的回合已经落账，给他那张顺位上 +1。
 *
 * 静默跳过是刻意的：没有进行中的顺位、或这人不在顺位上（开这条顺位之后才加入世界），都只是
 * 「没记上」，不能反过来影响回合本身。顺位是记录，不是回合的前置条件。
 */
export async function recordActionTaken(
  db: Database,
  gameId: string,
  actorId: string,
): Promise<boolean> {
  const order = await findActiveActionOrder(db, gameId);
  if (!order) {
    return false;
  }
  return incrementActionOrderEntry(db, order.id, actorId);
}
