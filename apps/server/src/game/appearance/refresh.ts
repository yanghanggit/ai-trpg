import type { Database } from "../../db/pool";
import type { ChatCompletionService } from "../../llm/protocol";
import type { Logger } from "../../logging";
import { listActorsForAppearance } from "../persistence/actors";
import { runAppearanceTurn } from "./turn";

/**
 * 批量重推外观：活人各推一次，尸体一律跳过。
 *
 * 尸体外观属于死亡阶段——那时才有尸体描写，也需要收尾标记保证只写一次；这里重推会绕过那份幂等。
 * 想让整局「外观与死亡都跟当前状态一致」的是调试入口，它在这之后接着跑死亡阶段。
 */

export type AppearanceRefreshOptions = {
  service: ChatCompletionService;
  logger?: Logger;
};

export type AppearanceRefreshResult = {
  /** 本次重推了外观的活人。 */
  refreshed: string[];
  /** 跳过的尸体：它们的外观由死亡阶段负责。 */
  skippedCorpses: string[];
};

/** 幂等重推：重推不往场景广播，也不改任何状态，只换新外观记录。 */
export async function refreshAppearances(
  db: Database,
  gameId: string,
  options: AppearanceRefreshOptions,
): Promise<AppearanceRefreshResult> {
  const result: AppearanceRefreshResult = { refreshed: [], skippedCorpses: [] };

  for (const row of await listActorsForAppearance(db, gameId)) {
    if (row.hp <= 0) {
      result.skippedCorpses.push(row.name);
      continue;
    }
    const appearance = await runAppearanceTurn(db, gameId, row.name, {
      service: options.service,
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

  return result;
}
