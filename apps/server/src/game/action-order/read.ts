import type { Database } from "../../db/pool";
import type { ActionOrderEntryState, ActionOrderState } from "../kernel/types";
import {
  type ActionOrderRow,
  findActionOrder,
  findActiveActionOrder,
  listActionOrderEntries,
  listOrderParticipants,
} from "../persistence/action-orders";
import { readGameClock, readGameVersion } from "../persistence/games";
import { nextEntry } from "./next";

/**
 * 读投影：顺位头 + 按名次升序的条目 + `gameVersion` 与 `nextActor`。
 *
 * 不给 id 就读当前进行中的那条；没有则返回 `null`，不用抛错区分「没开」与「已移除」。
 * 名次与敏捷是快照不回写；生死与执行方是当下事实，读出时补在条目上。
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
    clock: await readGameClock(db, row.gameId),
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
