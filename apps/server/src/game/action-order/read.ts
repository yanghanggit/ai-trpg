import type { Database } from "../../db/pool";
import type { ActionOrderEntryState, ActionOrderState } from "../kernel/types";
import {
  type ActionOrderRow,
  findActionOrder,
  findActiveActionOrder,
  listActionOrderEntries,
  listOrderParticipants,
} from "../persistence/action-orders";
import { readGameVersion } from "../persistence/games";
import { nextEntry } from "./next";

/**
 * 读投影：顺位头 + 按顺位升序的条目 + 两个读出来才算得出的派生值。
 *
 * 不给 id 就读当前进行中的那张；「还没有顺位」返回 `null` 而不是抛错，调用方据此区分
 * 「没开」与「已移除」。名次与敏捷是快照，读的时候不回写；生死与执行方是当下事实，
 * 单独补在条目上——「谁快轮到」「这一回合谁执行」本来就是在问当下。
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
  const participants = await listOrderParticipants(db, row.id);
  const entries: ActionOrderEntryState[] = (await listActionOrderEntries(db, row.id)).map(
    (entry) => ({
      ...entry,
      control: participants.get(entry.actorId)?.control ?? "agent",
      alive: participants.get(entry.actorId)?.alive ?? false,
    }),
  );
  const alive = new Set(entries.filter((entry) => entry.alive).map((entry) => entry.actorId));
  const picked = nextEntry(entries, alive);
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    entries,
    gameVersion: await readGameVersion(db, row.gameId),
    nextActor:
      picked === null
        ? null
        : {
            position: picked.position,
            actorId: picked.actorId,
            actorName: picked.actorName,
            control: picked.control,
          },
  };
}
