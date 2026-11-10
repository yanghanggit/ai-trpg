import type { Database } from "../../db/pool";
import { type TraceContext, traceEvent } from "../../debug/trace";
import type { ChatCompletionService } from "../../llm/protocol";
import type { Logger } from "../../logging";
import { describeError } from "../errors";
import {
  listDeathsToSettle,
  listStageIdsOfGame,
  type PendingDeath,
  resetRevivedDeathMarkers,
} from "../persistence/deaths";
import type { DeathSettlement } from "../types";
import { refreshCorpseAppearance } from "./corpse-appearance";
import { declareDeath } from "./declare";
import { dropCorpseMaterials } from "./drop";

/**
 * 死亡收尾是逐人推进的：调用方先取名单，再对每个人调一次 `settleDeath`。
 *
 * 一个人身上固定走三段 宣布 → 尸体外观 → 掉落：宣布时顺带把默认玩家的死亡通知
 * world，是否收尾由 world 回合决定；尸体外观排在掉落之前，掉落才能读到刚写下的
 * 尸体描写。三段各自失败只落在这一条记录里，不影响别人，也不回滚触发它的行动。
 *
 * 幂等分两段，不要混为一谈：
 * - 宣布是至少一次。认领失败或事务回滚都不写标记，下次扫描会重试。
 * - 尸体外观与掉落是至多一次。它们排在认领之后，每次认领只跑一次，失败了不补账，
 *   也不另加收尾标记：开发期不为这一步引入新的待补状态，等到需要重试时再说。
 *   所以外观失败时，掉落读到的是生前最后一条外观，不是尸体描写。
 *
 * 认领语义见 `claimDeath`，取舍见 docs/database.md。
 */

/** 收尾一个死者的依赖：不传 service 就只跑宣布。 */
export type DeathSettlementOptions = {
  service?: ChatCompletionService;
  logger?: Logger;
  /** 触发这次收尾的回合轨迹；子阶段结果写进该回合。 */
  trace?: TraceContext;
};

/**
 * 取这一局当前待收尾的死者。
 *
 * 包含一次维护性清理：hp 被抬回正数（复活或外部写入）时清掉旧标记，等下次死亡重新
 * 宣布。这个清理没有 per-actor 的归宿——框架里 hp 只降不升，复活目前不存在于框架，
 * 只来自脚本或旧数据——所以它跟着扫描走，而不是跟着某一个人的收尾走。
 */
export async function scanDeathsToSettle(db: Database, gameId: string): Promise<PendingDeath[]> {
  const stageIds = await listStageIdsOfGame(db, gameId);
  if (stageIds.length === 0) {
    return [];
  }
  await resetRevivedDeathMarkers(db, stageIds);
  return listDeathsToSettle(db, gameId);
}

/** 三段各自的日志标签；`settleDeath` 的失败记账都从这里取。 */
const PHASE_LABELS = {
  death: "死亡宣布",
  appearance: "尸体外观",
  drop: "尸体掉落",
} as const;

/**
 * 收尾一个死者：宣布 → 尸体外观 → 掉落。
 *
 * 业务失败写在返回值里，不抛：调用方（行动落账、CLI）不该因为一具尸体没写好而失败。
 */
export async function settleDeath(
  db: Database,
  gameId: string,
  actor: PendingDeath,
  options: DeathSettlementOptions = {},
): Promise<DeathSettlement> {
  const { service, logger, trace } = options;
  const settlement: DeathSettlement = { actorName: actor.name, declared: false, dropped: [] };

  const fail = async (
    phase: keyof typeof PHASE_LABELS,
    reason: string,
    cause?: unknown,
  ): Promise<void> => {
    if (phase === "death") {
      settlement.failure = reason;
    } else if (phase === "appearance") {
      settlement.appearanceFailure = reason;
    } else {
      settlement.dropFailure = reason;
    }
    const retry = phase === "death" ? "，下次调用会重试" : "";
    logger?.warn(`${PHASE_LABELS[phase]}失败: ${actor.name}（${reason}）${retry}`, cause);
    await traceEvent(trace, {
      event: "phase",
      name: phase,
      status: "failed",
      actorName: actor.name,
      detail: { reason },
    });
  };

  try {
    // 输了认领：别人已经宣布，或死者刚复活。
    if (
      !(await declareDeath(db, gameId, actor, {
        ...(trace ? { trace } : {}),
        ...(logger ? { logger } : {}),
      }))
    ) {
      return settlement;
    }
  } catch (error) {
    // 事务回滚会连认领一起回滚，所以失败仍然可以重试。
    await fail("death", describeError(error), error);
    return settlement;
  }

  settlement.declared = true;
  await traceEvent(trace, {
    event: "phase",
    name: "death",
    status: "ok",
    actorName: actor.name,
  });

  if (!service) {
    return settlement;
  }
  const subPhaseOptions = {
    service,
    ...(logger ? { logger } : {}),
    ...(trace ? { trace } : {}),
  };

  // 尸体外观排在掉落之前：掉落要读刚写下的尸体描写。
  try {
    const appearance = await refreshCorpseAppearance(db, gameId, actor.name, subPhaseOptions);
    if (appearance.ok) {
      await traceEvent(trace, {
        event: "phase",
        name: "appearance",
        status: "ok",
        actorName: actor.name,
      });
    } else {
      await fail("appearance", appearance.reason ?? "未知原因");
    }
  } catch (error) {
    await fail("appearance", describeError(error), error);
  }

  try {
    const drop = await dropCorpseMaterials(db, gameId, actor.name, subPhaseOptions);
    if (!drop.ok) {
      await fail("drop", drop.reason ?? "未知原因");
    } else {
      settlement.dropped = drop.dropped;
      await traceEvent(trace, {
        event: "phase",
        name: "drop",
        status: "ok",
        actorName: actor.name,
        detail: { items: drop.dropped },
      });
    }
  } catch (error) {
    await fail("drop", describeError(error), error);
  }

  return settlement;
}
