import type { Database } from "../../db/pool";
import { findActiveActionOrder, incrementActionOrderEntry } from "../persistence/action-orders";
import { advanceGameClock } from "../persistence/games";
import type { Executor } from "../persistence/rows";

/**
 * 记一个回合：这个 actor 的回合已经过去（有行动落账，或调用方明示空回合），顺位上 +1。
 *
 * 静默跳过是刻意的：没有进行中的顺位、或这人不在顺位上（开这条顺位之后才加入世界），
 * 都只是「没记上」，不能反过来影响回合本身。顺位是记录，不是回合的前置条件。
 */
export async function recordTurnTaken(
  executor: Executor,
  gameId: string,
  actorId: string,
): Promise<boolean> {
  const order = await findActiveActionOrder(executor, gameId);
  if (!order) {
    return false;
  }
  return incrementActionOrderEntry(executor, order.id, actorId);
}

/**
 * 空回合的唯一落账点：时间前进一格，再给顺位计数加一。
 *
 * 两件事一起做，因为它们描述同一个事实「这一回合过去了」；没有进行中的顺位时只推进时间，
 * 计数仍然只是「没记上」。与有动作的回合同一口径：时间在落账时前进。
 */
export async function recordPassTurn(
  db: Database,
  gameId: string,
  actorId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await advanceGameClock(tx, gameId);
    return recordTurnTaken(tx, gameId, actorId);
  });
}
