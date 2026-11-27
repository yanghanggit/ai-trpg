import type { Database } from "../../db/pool";
import type {
  ActionOrderEntryState,
  ActionOrderRoundState,
  ActionOrderState,
} from "../kernel/types";
import {
  type ActionOrderRow,
  findActionOrder,
  findActiveActionOrder,
  listActionOrderEntries,
  listActionOrderTurnsOfRound,
  listOrderParticipants,
  readLastTurnRound,
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

/**
 * 行动轮：本轮的进度读数，从回合账上算，不落库。
 *
 * 报的是「最近一笔账所属的行动轮」：world 落账之后仍然报它，直到下一笔角色回合开新轮——
 * 所以「这一轮的 world 推过没有」是一个稳定的读数，而不是会被推完就清零的状态。
 * 只读那一轮的行，长度与「这一轮走了几步」成正比，不随局的长度增长。
 */
export async function readActionOrderRound(
  db: Database,
  orderId: string,
): Promise<ActionOrderRoundState> {
  const last = await readLastTurnRound(db, orderId);
  const index = last ?? 1;
  const turns = last === null ? [] : await listActionOrderTurnsOfRound(db, orderId, index);
  const actors: ActionOrderRoundState["actors"] = [];
  const stages = new Map<string, { stageId: string; name: string; turns: number }>();
  let world = false;
  for (const turn of turns) {
    if (turn.kind === "actor" || turn.kind === "pass") {
      actors.push({
        actorId: turn.subjectId,
        name: turn.subjectName,
        empty: turn.kind === "pass",
      });
      continue;
    }
    if (turn.kind === "stage") {
      const stageId = turn.stageId ?? turn.subjectId;
      const existing = stages.get(stageId);
      if (existing === undefined) {
        stages.set(stageId, { stageId, name: turn.subjectName, turns: 1 });
      } else {
        existing.turns += 1;
      }
      continue;
    }
    world = true;
  }
  return {
    index,
    actors,
    stages: [...stages.values()],
    world,
  };
}
