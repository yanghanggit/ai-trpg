import type { Database } from "../../db/pool";
import type { ActionOrderState } from "../kernel/types";
import {
  type ActionOrderRow,
  findActionOrder,
  findActiveActionOrder,
  listActionOrderEntries,
} from "../persistence/action-orders";

/**
 * 读投影：顺位头 + 按顺位升序的条目。
 *
 * 不给 id 就读当前进行中的那张；「还没有顺位」返回 `null` 而不是抛错，调用方据此区分
 * 「没开」与「已移除」。这里不拼 actor 的活状态：顺位是快照，读的时候不该被现在的
 * 敏捷或生命改写。
 */
export async function readActionOrder(
  db: Database,
  gameId: string,
  orderId?: string,
): Promise<ActionOrderState | null> {
  const row =
    orderId === undefined
      ? await findActiveActionOrder(db, gameId)
      : await findActionOrder(db, gameId, orderId);
  if (!row) {
    return null;
  }
  return projectActionOrder(db, row);
}

export async function projectActionOrder(
  db: Database,
  row: ActionOrderRow,
): Promise<ActionOrderState> {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    entries: await listActionOrderEntries(db, row.id),
  };
}
