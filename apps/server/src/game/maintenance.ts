import type { Database } from "../db/pool";
import { runAppearanceTurn } from "./appearance";
import type { DeathPhaseOptions } from "./death";
import { settleDeaths } from "./death";
import { listActorsForAppearance } from "./persistence/actors";
import type { DeathPhaseFailure } from "./types";

/**
 * 批量维护扫描：活人重推外观，未收尾的死者交给死亡阶段，已收尾的尸体跳过。
 *
 * 它不属于任何单个回合，所以单独成模块：两个入口（`agent:game appearance` /
 * `agent:game deaths`）共用同一份顺序，免得各自漏掉其中一步。
 */

export type AppearanceMaintenanceResult = {
  /** 本次重推了外观的活人。 */
  refreshed: string[];
  /** 本次宣布死亡的死者。 */
  settled: string[];
  /** 宣布失败、需要重试的死者。 */
  failed: DeathPhaseFailure[];
  /** 死亡已广播、但外观快照没推成的死者。 */
  appearanceFailed: string[];
  /** 已宣布过死亡、被批量入口跳过的尸体；要重推必须显式指定 actor。 */
  skipped: string[];
};

/**
 * 批量外观维护：活人重推、未收尾的死者交给死亡阶段、已收尾的尸体跳过。
 *
 * 靠 `death_settled_at` 保证幂等；要重推尸体外观用单点入口（`agent:game appearance --actor`）。
 */
export async function refreshAppearances(
  db: Database,
  gameId: string,
  options: DeathPhaseOptions,
): Promise<AppearanceMaintenanceResult> {
  const result: AppearanceMaintenanceResult = {
    refreshed: [],
    settled: [],
    failed: [],
    appearanceFailed: [],
    skipped: [],
  };
  const { service } = options;
  if (!service) {
    return result;
  }

  const rows = await listActorsForAppearance(db, gameId);

  for (const row of rows) {
    if (row.hp <= 0) {
      if (row.deathSettledAt !== null) {
        result.skipped.push(row.name);
      }
      continue;
    }
    const appearance = await runAppearanceTurn(db, gameId, row.name, {
      service,
      // 批量维护是幂等重推，不往每个场景贴广播。
      broadcast: false,
      ...(options.logger ? { logger: options.logger } : {}),
    });
    if (appearance.ok) {
      result.refreshed.push(row.name);
    } else {
      options.logger?.warn(`外观重推失败: ${row.name}`);
    }
  }

  const deathPhase = await settleDeaths(db, gameId, options);
  result.settled = deathPhase.settled;
  result.failed = deathPhase.failed;
  result.appearanceFailed = deathPhase.appearanceFailed;
  return result;
}
