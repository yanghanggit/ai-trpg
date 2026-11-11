import { and, eq, gt, inArray, isNull, lte, not } from "drizzle-orm";
import { actors, stages, worlds } from "../../db/schema";
import type { Executor } from "./rows";

/**
 * 死亡相关的读写。
 *
 * 死亡不是状态字段，而是 `hp === 0`；`death_settled_at` 只是「这次死亡已经宣布过了吗」
 * 的处理标记。这些谓词属于领域规则，集中在这里，死亡阶段只负责编排。
 */

/** 本局所有舞台 id：死亡扫描与收尾标记清理都只在局内生效。 */
export async function listStageIdsOfGame(executor: Executor, gameId: string): Promise<string[]> {
  const worldRows = await executor
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.gameId, gameId));
  if (worldRows.length === 0) {
    return [];
  }
  const rows = await executor
    .select({ id: stages.id })
    .from(stages)
    .where(
      inArray(
        stages.worldId,
        worldRows.map((row) => row.id),
      ),
    );
  return rows.map((row) => row.id);
}

/** hp 被抬回正数（复活或外部写入）时清掉旧标记，等下次死亡重新宣布。 */
export async function resetRevivedDeathMarkers(
  executor: Executor,
  stageIds: readonly string[],
): Promise<void> {
  if (stageIds.length === 0) {
    return;
  }
  await executor
    .update(actors)
    .set({ deathSettledAt: null })
    .where(
      and(inArray(actors.stageId, stageIds), gt(actors.hp, 0), not(isNull(actors.deathSettledAt))),
    );
}

/** 一个待收尾的死者：宣布与它之后的子阶段只需要这几个字段。 */
export type PendingDeath = {
  id: string;
  name: string;
  stageId: string;
  isDefaultPlayer: boolean;
};

/** 本局里 hp 归零、且还没宣布过死亡的 actor。 */
export async function listDeathsToSettle(
  executor: Executor,
  gameId: string,
): Promise<PendingDeath[]> {
  return executor
    .select({
      id: actors.id,
      name: actors.name,
      stageId: actors.stageId,
      isDefaultPlayer: actors.isDefaultPlayer,
    })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .innerJoin(worlds, eq(stages.worldId, worlds.id))
    .where(and(eq(worlds.gameId, gameId), lte(actors.hp, 0), isNull(actors.deathSettledAt)));
}

/**
 * 认领一次死亡收尾：把标记从未置位改成已置位的调用者才有资格宣布。
 *
 * 条件带 `hp <= 0`，所以这是针对整个死亡谓词的 compare-and-set：并发只有一个赢家，
 * 刚被复活的死者也不会被误宣布。
 */
export async function claimDeath(executor: Executor, actorId: string, now: Date): Promise<boolean> {
  const claimed = await executor
    .update(actors)
    .set({ deathSettledAt: now, updatedAt: now })
    .where(and(eq(actors.id, actorId), lte(actors.hp, 0), isNull(actors.deathSettledAt)))
    .returning({ id: actors.id });
  return claimed.length > 0;
}
