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
import type { DeathPhaseResult } from "../types";
import { announceDeath } from "./announce";
import { refreshCorpseAppearance } from "./corpse-appearance";
import { runDropPhase } from "./drop";

/**
 * 死亡阶段：把「`hp` 归零但还没宣布」的死者各收尾一次。
 *
 * 由 hp 变化的调用方在事务之后触发，也可显式调用。每个死者的顺序固定为
 * 宣布 → 尸体外观 → 掉落：宣布时顺带把默认玩家的死亡通知 world，是否收尾由 world
 * 回合决定；尸体外观排在掉落之前，掉落才能读到刚写下的尸体描写。
 *
 * 幂等分两段，不要混为一谈：
 * - 宣布是至少一次。认领失败或事务回滚都不写标记，下次扫描会重试。
 * - 尸体外观与掉落是至多一次。它们排在认领之后，每次认领只跑一次，失败了不补账，
 *   也不另加收尾标记：开发期不为这一步引入新的待补状态，等到需要重试时再说。
 *   所以外观失败时，掉落读到的是生前最后一条外观，不是尸体描写。
 *
 * 每个死者独立结算；失败只进返回值与日志，不回滚也不否定触发它的行动。
 * 认领语义见 `claimDeath`，取舍见 docs/database.md。
 */

export type DeathPhaseOptions = {
  /** 尸体外观与掉落都需要 LLM；不传就只跑宣布。 */
  service?: ChatCompletionService;
  logger?: Logger;
  /** 触发这次死亡阶段的回合轨迹；子阶段结果写进该回合。 */
  trace?: TraceContext;
};

/** 同一局的并发调用合流到同一次扫描。 */
const running = new Map<string, Promise<DeathPhaseResult>>();

/** 入口：并发合流后跑一次扫描，细节见上方模块注释与 `runDeathPhase`。 */
export async function settleDeaths(
  db: Database,
  gameId: string,
  options: DeathPhaseOptions = {},
): Promise<DeathPhaseResult> {
  const inFlight = running.get(gameId);
  if (inFlight) {
    return inFlight;
  }
  const phase = runDeathPhase(db, gameId, options).finally(() => {
    running.delete(gameId);
  });
  running.set(gameId, phase);
  return phase;
}

/** 一个死者的三个子阶段；失败只记自己那一条，不影响其余死者。 */
type DeathSubPhase = "death" | "appearance" | "drop";

const SUB_PHASE_LABELS: Record<DeathSubPhase, string> = {
  death: "死亡宣布",
  appearance: "尸体外观",
  drop: "尸体掉落",
};

async function runDeathPhase(
  db: Database,
  gameId: string,
  options: DeathPhaseOptions,
): Promise<DeathPhaseResult> {
  const { service, logger, trace } = options;
  const result: DeathPhaseResult = {
    settled: [],
    failed: [],
    appearanceFailed: [],
    dropped: [],
    dropFailed: [],
  };

  const stageIds = await listStageIdsOfGame(db, gameId);
  if (stageIds.length === 0) {
    return result;
  }

  // 复活或外部写入把 hp 抬回正数时清标记，等下次死亡重新宣布。
  await resetRevivedDeathMarkers(db, stageIds);
  const dying = await listDeathsToSettle(db, gameId);

  // 尸体外观与掉落共用同一份依赖：不传 service 就只跑宣布。
  const subPhaseOptions = service
    ? { service, ...(logger ? { logger } : {}), ...(trace ? { trace } : {}) }
    : undefined;

  const fail = async (
    phase: DeathSubPhase,
    actorName: string,
    reason: string,
    cause?: unknown,
  ): Promise<void> => {
    switch (phase) {
      case "death":
        result.failed.push({ actorName, reason });
        break;
      case "appearance":
        result.appearanceFailed.push(actorName);
        break;
      case "drop":
        result.dropFailed.push(actorName);
        break;
    }
    const retry = phase === "death" ? "，下次调用会重试" : "";
    logger?.warn(`${SUB_PHASE_LABELS[phase]}失败: ${actorName}（${reason}）${retry}`, cause);
    await traceEvent(trace, {
      event: "phase",
      name: phase,
      status: "failed",
      actorName,
      detail: { reason },
    });
  };

  /** 单个死者的收尾：三段依次跑，前一段失败不否定后一段该不该跑。 */
  const settleActor = async (actor: PendingDeath): Promise<void> => {
    try {
      // 输了认领：别人已经宣布，或死者刚复活。
      if (
        !(await announceDeath(db, gameId, actor, {
          ...(trace ? { trace } : {}),
          ...(logger ? { logger } : {}),
        }))
      ) {
        return;
      }
    } catch (error) {
      // 事务回滚会连认领一起回滚，所以失败仍然可以重试。
      await fail("death", actor.name, describeError(error), error);
      return;
    }

    result.settled.push(actor.name);
    await traceEvent(trace, {
      event: "phase",
      name: "death",
      status: "ok",
      actorName: actor.name,
    });

    if (!subPhaseOptions) {
      return;
    }

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
        await fail("appearance", actor.name, appearance.reason ?? "未知原因");
      }
    } catch (error) {
      await fail("appearance", actor.name, describeError(error), error);
    }

    try {
      const drop = await runDropPhase(db, gameId, actor.name, subPhaseOptions);
      if (!drop.ok) {
        await fail("drop", actor.name, drop.reason ?? "未知原因");
        return;
      }
      if (drop.dropped.length > 0) {
        result.dropped.push({ actorName: actor.name, items: drop.dropped });
      }
      await traceEvent(trace, {
        event: "phase",
        name: "drop",
        status: "ok",
        actorName: actor.name,
        detail: { items: drop.dropped },
      });
    } catch (error) {
      await fail("drop", actor.name, describeError(error), error);
    }
  };

  await Promise.all(dying.map(settleActor));
  return result;
}
