import type { Database } from "../../db/pool";
import { traceEvent } from "../../debug/trace";
import { runAffixPhase } from "../agents/affixes";
import { updateAppearance } from "../agents/appearance";
import { scanDeathsToSettle, settleDeath } from "../agents/death";
import { describeError, GameError } from "../errors";
import type { DeathSettlement } from "../kernel/types";
import type { IncrementOptions, SettlePlanResult } from "./types";

/**
 * 结算的推理端：默认效果提交之后才跑，纯增量。
 *
 * 失败只等于「这次没有增量」——不回滚计算端结果，也不阻断后面其它阶段；不做跨回合补账，
 * 但失败要进过程轨迹。顺序固定：词缀 → 外观 → 死亡收尾。
 */

export type IncrementResult = {
  /** 这次行动之后逐个收尾的死者；没有死者时是空数组。 */
  death: DeathSettlement[];
  /** 取死者名单没能跑起来的原因；行动本身仍然成功。 */
  deathError?: string;
};

export async function runIncrementPhases(
  db: Database,
  gameId: string,
  actor: { id: string; name?: string },
  result: SettlePlanResult,
  options: IncrementOptions,
): Promise<IncrementResult> {
  if (result.affixRequests && result.affixRequests.length > 0) {
    // 每个道具各自结算：一个失败只丢自己的增量，不影响其余，也不影响已提交的默认效果。
    for (const request of result.affixRequests) {
      await runAffixPhase(db, gameId, request, options.service, options.trace, options.logger);
    }
  }

  // 换装改的是「别人看到的样子」：在事务外补一次外观推理。
  // 失败与死亡阶段一致，只记日志，不回滚已落账的穿戴。
  const equipmentChanged = (result.applied ?? []).some(
    ({ actionKind }) => actionKind === "equip" || actionKind === "unequip",
  );
  if (equipmentChanged && options.inferenceService) {
    if (!actor.name) {
      throw new GameError("invalid_state", `actor 名称缺失: ${actor.id}`);
    }
    let failureReason: string | undefined;
    try {
      const appearance = await updateAppearance(db, gameId, actor.name, {
        service: options.inferenceService,
        ...(options.logger ? { logger: options.logger } : {}),
        ...(options.trace ? { trace: options.trace } : {}),
      });
      if (!appearance.ok) {
        failureReason = appearance.reason ?? "未生成外观";
      }
    } catch (error) {
      failureReason = describeError(error);
      options.logger?.warn("换装后外观重算失败", error);
    }
    await traceEvent(options.trace, {
      event: "phase",
      name: "appearance",
      status: failureReason ? "failed" : "ok",
      ...(failureReason ? { detail: { reason: failureReason } } : {}),
    });
  }

  // 死亡收尾在事务外跑：它要调 LLM，失败也不能回滚这次行动。
  // 一次行动可能打死多个目标，所以先取名单再逐个推进；单个死者失败只落在自己那条记录里。
  const settlementOptions = {
    ...(options.inferenceService ? { service: options.inferenceService } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  };
  const settlements: DeathSettlement[] = [];
  let deathError: string | undefined;
  try {
    for (const target of await scanDeathsToSettle(db, gameId)) {
      settlements.push(await settleDeath(db, gameId, target, settlementOptions));
    }
  } catch (error) {
    // 名单没取成：下一次 hp 变化或 `agent:game deaths` 会再来。
    deathError = error instanceof Error ? error.message : String(error);
    options.logger?.warn("死亡收尾扫描失败，下次调用会重试", error);
  }
  return { death: settlements, ...(deathError ? { deathError } : {}) };
}
