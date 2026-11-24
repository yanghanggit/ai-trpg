import type { Database } from "../../db/pool";
import { allActors } from "../actor-state";
import { GameError } from "../errors";
import { orderActors } from "../gameplay/ordering";
import type { ActionOrderState, GameStateSlice } from "../kernel/types";
import { findActiveActionOrder, insertActionOrder } from "../persistence/action-orders";
import { readActionOrder } from "./read";

/**
 * 建一张顺位：次序由服务端算，调用方只回答「现在开一张」。
 *
 * 这里只做台账该做的事——取此刻的 actor、把 gameplay 排好的次序编号 1..N、落库。
 * 「谁排前面」的判定在 `gameplay/ordering.ts`，本文件不认识敏捷。
 *
 * 「一局同时只有一张进行中的顺位」是硬约束，不是建议：先查再插只是为了让失败带上
 * 人话，真正的兜底是 `action_orders_game_active_unique`，并发下两张只能成一张。
 */
export async function openActionOrder(
  db: Database,
  state: GameStateSlice,
): Promise<ActionOrderState> {
  if (state.game.status !== "active") {
    throw new GameError("invalid_state", `游戏已结束: ${state.game.status}`);
  }
  if (await findActiveActionOrder(db, state.game.id)) {
    throw new GameError("invalid_state", "已有进行中的行动顺位，先完成或移除它");
  }

  const ordered = orderActors(allActors(state).map(({ actor }) => actor));
  if (ordered.length === 0) {
    throw new GameError("invalid_state", "没有可进入顺位的 actor");
  }
  const entries = ordered.map((entry, index) => ({
    actorId: entry.actorId,
    position: index + 1,
    agility: entry.agility,
  }));

  const orderId = await db.transaction((tx) =>
    insertActionOrder(tx, { gameId: state.game.id, entries }),
  );
  const order = await readActionOrder(db, state.game.id, orderId);
  if (!order) {
    throw new GameError("invalid_state", `行动顺位写入后读不回来: ${orderId}`);
  }
  return order;
}
