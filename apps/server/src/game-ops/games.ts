/**
 * 控制面的局列表：某个 owner 名下有哪些局、每局跑到哪。
 *
 * 可见性口径与路由的 `requireGameAccess` 相同——只有 owner 名下的局会出现。跨 owner 排查
 * 需要白名单或角色，那是鉴权的事，不在这里放宽。
 *
 * 活跃作业一次批量取回：列表页不该按局逐个查。回合作业的串行键就是局，且同一局同时只有
 * 一个活跃作业，所以这里得到的是「这一局现在有没有回合在跑」，不是一个可累加的计数。
 */

import type { Database } from "../db/pool";
import { listGamesByOwner } from "../game/persistence/games";
import { ACTIVE_JOB_STATUSES, JobStore } from "../jobs";
import { turnSerializationKey } from "./turn-jobs";

export type GameSummaryView = {
  id: string;
  slug: string;
  name: string;
  status: string;
  /** 结束时的结局标签；active 局为 null。 */
  outcome: string | null;
  contentVersion: string;
  version: number;
  /** 逻辑时钟：已落账的回合数，0 是开局。 */
  clock: number;
  createdAt: string;
  updatedAt: string;
  /** 正在排队或执行的回合；没有就是 null。 */
  activeJob: { jobId: string; kind: string; status: string } | null;
};

export type ListGamesOptions = {
  status?: "active" | "completed";
  limit?: number;
};

export async function listGamesOp(
  db: Database,
  ownerId: string,
  options: ListGamesOptions = {},
): Promise<{ games: GameSummaryView[] }> {
  const rows = await listGamesByOwner(db, ownerId, options);

  const gameIdByKey = new Map(rows.map((row) => [turnSerializationKey(row.id), row.id]));
  const activeRecords =
    gameIdByKey.size === 0
      ? []
      : await new JobStore(db).listRecords({
          serializationKeys: [...gameIdByKey.keys()],
          statuses: ACTIVE_JOB_STATUSES,
          limit: 500,
        });

  const activeJobByGame = new Map<string, { jobId: string; kind: string; status: string }>();
  for (const record of activeRecords) {
    const gameId =
      record.serializationKey === null ? undefined : gameIdByKey.get(record.serializationKey);
    if (gameId !== undefined) {
      activeJobByGame.set(gameId, {
        jobId: record.jobId,
        kind: record.kind,
        status: record.status,
      });
    }
  }

  return {
    games: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      outcome: row.outcome,
      contentVersion: row.contentVersion,
      version: row.version,
      clock: row.clock,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      activeJob: activeJobByGame.get(row.id) ?? null,
    })),
  };
}
