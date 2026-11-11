import type { Database } from "../../db/pool";
import { traceEvent } from "../../debug/trace";
import type { ActorPlan } from "../kernel/types";
import { auditTurnNameLeaks, nameAuditEnabled, nameAuditSince } from "../name-audit";
import { runIncrementPhases } from "./increment";
import { settlePlan } from "./plan";
import type { SettleActorPlanOptions, SettlePlanResult } from "./types";

export type { SettleActorPlanOptions, SettlePlanResult } from "./types";

/**
 * 一次 actor 计划的结算：计算端（一个事务）提交，推理端（词缀 → 外观 → 死亡收尾）追加。
 *
 * LLM 不进入数据库事务。推理端只做增量：词缀阶段的任何失败（含未配置 service）都只丢
 * 增量，不回滚默认效果，也不阻断随后的死亡阶段。
 */
export async function settleActorPlan(
  db: Database,
  gameId: string,
  actorId: string,
  plan: ActorPlan | null,
  loopSuccess: boolean,
  options: SettleActorPlanOptions = {},
): Promise<SettlePlanResult> {
  const nameAuditStartedAt = nameAuditSince();
  const auditNames = async (): Promise<void> => {
    if (!(options.auditNameLeaks ?? nameAuditEnabled())) {
      return;
    }
    await auditTurnNameLeaks(db, gameId, nameAuditStartedAt, {
      ...(options.logger ? { logger: options.logger } : {}),
      ...(options.trace ? { trace: options.trace } : {}),
    });
  };

  const settlement = await settlePlan(db, gameId, actorId, plan, loopSuccess, options.trace);

  await traceEvent(options.trace, { event: "plan", actions: plan?.actions ?? [] });
  if (!settlement.result.ok) {
    await traceEvent(options.trace, {
      event: "rejected",
      code: settlement.result.rejectionCode ?? "rejected",
      reason: settlement.result.rejection ?? "未知原因",
    });
    await auditNames();
    return settlement.result;
  }
  for (const applied of settlement.result.applied ?? []) {
    await traceEvent(options.trace, applied);
  }

  const increment = await runIncrementPhases(
    db,
    gameId,
    { id: actorId, ...(settlement.actorName ? { name: settlement.actorName } : {}) },
    settlement.result,
    options,
  );
  settlement.result.death = increment.death;
  if (increment.deathError) {
    settlement.result.deathError = increment.deathError;
  }

  await auditNames();
  return settlement.result;
}
