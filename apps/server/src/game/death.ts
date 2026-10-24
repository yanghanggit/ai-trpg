import { and, eq, gt, inArray, isNull, lte, not } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors, stages, worlds } from "../db/schema";
import type { ChatCompletionService } from "../llm/protocol";
import { runAppearanceTurn } from "./appearance";

export type DeathPhaseOptions = {
  /** 死亡阶段要做外观推理，因此需要 LLM；没有 service 时整段跳过，留待下次。 */
  service?: ChatCompletionService;
  logger?: Parameters<typeof runAppearanceTurn>[3]["logger"];
};

export type DeathPhaseResult = {
  /** 本次跑完死亡阶段的 actor 名字。 */
  settled: string[];
  /** 失败或跳过的 actor 名字；下次 hp 变化或显式调用时会重试。 */
  pending: string[];
};

/**
 * 死亡阶段：扫描本局全部 actor，让每个「hp 已归零但还没收尾」的 actor 各跑一次。
 *
 * 三条约定：
 * - 死亡不是状态字段，而是 `hp === 0` 这个事实；攻击方只写 hp，不判定死亡。
 * - 收尾属于死者自己（当前是外观快照，未来是复活饰品判定），因此在 hp 变化的事务
 *   之后全局扫描，而不是塞进攻击方的结算里；每个死者的收尾互不影响，并发执行。
 * - `death_settled_at` 只是「这次死亡收尾跑过了吗」的处理标记，不是生命状态；
 *   一旦 hp 被抬回正数（复活），标记会被清空，等下次死亡重新收尾。
 */
export async function settleDeaths(
  db: Database,
  gameId: string,
  options: DeathPhaseOptions = {},
): Promise<DeathPhaseResult> {
  const result: DeathPhaseResult = { settled: [], pending: [] };
  const { service } = options;
  if (!service) {
    return result;
  }

  const stageIds = await stageIdsOf(db, gameId);
  if (stageIds.length === 0) {
    return result;
  }

  // 复活或外部写入把 hp 拉回正数时，清掉旧的收尾标记，等下次死亡重新跑。
  await db
    .update(actors)
    .set({ deathSettledAt: null })
    .where(
      and(inArray(actors.stageId, stageIds), gt(actors.hp, 0), not(isNull(actors.deathSettledAt))),
    );

  const dying = await db
    .select({ id: actors.id, name: actors.name })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .innerJoin(worlds, eq(stages.worldId, worlds.id))
    .where(and(eq(worlds.gameId, gameId), lte(actors.hp, 0), isNull(actors.deathSettledAt)));

  // 每个死者各自独立收尾：一个失败不影响其它人。
  await Promise.all(
    dying.map(async (actor) => {
      try {
        const appearance = await runAppearanceTurn(db, gameId, actor.id, {
          service,
          ...(options.logger ? { logger: options.logger } : {}),
        });
        if (!appearance.ok) {
          result.pending.push(actor.name);
          return;
        }
        await db.update(actors).set({ deathSettledAt: new Date() }).where(eq(actors.id, actor.id));
        result.settled.push(actor.name);
      } catch {
        result.pending.push(actor.name);
      }
    }),
  );

  return result;
}

/** 本局所有场景 id；死亡阶段与收尾标记清理都只在局内生效。 */
async function stageIdsOf(db: Database, gameId: string): Promise<string[]> {
  const worldRows = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.gameId, gameId));
  if (worldRows.length === 0) {
    return [];
  }
  const rows = await db
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

export type AppearanceMaintenanceResult = {
  /** 本次重推了外观的活人。 */
  refreshed: string[];
  /** 本次跑完收尾的死者。 */
  settled: string[];
  /** 收尾失败、下次重试的死者。 */
  pending: string[];
  /** 已收尾、被批量入口跳过的尸体；要重推必须显式指定 actor。 */
  skipped: string[];
};

/**
 * 批量外观维护：活人各推一次；未收尾的死者交给死亡阶段；已收尾的尸体跳过。
 *
 * 批量入口必须幂等——`hp` 只是"是不是死的"，判断不出"这次死亡收尾跑过没有"，
 * 所以这里用 `death_settled_at` 过滤，避免每跑一次就把尸体外观重写一遍。
 * 想重推某具尸体的外观，用单点入口（`agent:game appearance --actor <name>`）。
 */
export async function refreshAppearances(
  db: Database,
  gameId: string,
  options: DeathPhaseOptions,
): Promise<AppearanceMaintenanceResult> {
  const result: AppearanceMaintenanceResult = {
    refreshed: [],
    settled: [],
    pending: [],
    skipped: [],
  };
  const { service } = options;
  if (!service) {
    return result;
  }

  const rows = await db
    .select({
      id: actors.id,
      name: actors.name,
      hp: actors.hp,
      deathSettledAt: actors.deathSettledAt,
    })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .innerJoin(worlds, eq(stages.worldId, worlds.id))
    .where(eq(worlds.gameId, gameId))
    .orderBy(actors.name);

  for (const row of rows) {
    if (row.hp <= 0) {
      if (row.deathSettledAt !== null) {
        result.skipped.push(row.name);
      }
      continue;
    }
    const appearance = await runAppearanceTurn(db, gameId, row.id, {
      service,
      ...(options.logger ? { logger: options.logger } : {}),
    });
    if (appearance.ok) {
      result.refreshed.push(row.name);
    }
  }

  const deathPhase = await settleDeaths(db, gameId, options);
  result.settled = deathPhase.settled;
  result.pending = deathPhase.pending;
  return result;
}
