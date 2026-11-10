import type { Database } from "../../db/pool";
import { type TraceContext, traceEvent } from "../../debug/trace";
import type { ChatCompletionService } from "../../llm/protocol";
import type { Logger } from "../../logging";
import { refreshCorpseAppearance } from "../appearance";
import { runDropTurn } from "../drops";
import { describeError } from "../errors";
import {
  listDeathsToSettle,
  listStageIdsOfGame,
  resetRevivedDeathMarkers,
} from "../persistence/deaths";
import type { DeathPhaseResult } from "../types";
import { announceDeath } from "./announce";

/**
 * 死亡阶段：把「`hp` 归零但还没宣布」的死者各收尾一次。
 *
 * 由 hp 变化的调用方在事务之后触发，也可显式调用。顺序固定为 宣布 → 尸体外观 → 掉落：
 * 宣布时顺带把默认玩家的死亡通知 world，是否收尾由 world 回合决定；尸体外观
 * 排在掉落之前，掉落才能读到刚写下的尸体描写。
 *
 * 每个死者独立结算；失败只进返回值与日志，不回滚也不否定触发它的行动，等下次调用重试。
 * 认领语义见 `claimDeath`，取舍见 docs/database.md。
 */

export type DeathPhaseOptions = {
  /** 只有尸体外观快照需要 LLM；不传就跳过外观。 */
  service?: ChatCompletionService;
  logger?: Logger;
  /** 触发这次死亡阶段的回合轨迹；子阶段结果写进该回合。 */
  trace?: TraceContext;
};

/** 同一局的并发调用合流到同一次扫描。 */
const running = new Map<string, Promise<DeathPhaseResult>>();

/**
 * 死亡阶段：把「`hp` 归零但还没宣布」的死者各收尾一次。
 *
 * 由 hp 变化的调用方在事务之后触发，也可显式调用。顺序固定为 宣布 → 尸体外观 → 掉落：
 * 宣布时顺带把默认玩家的死亡通知 world，是否收尾由 world 回合决定；尸体外观
 * 排在掉落之前，掉落才能读到刚写下的尸体描写。
 *
 * 每个死者独立结算；失败只进返回值与日志，不回滚也不否定触发它的行动，等下次调用重试。
 * 认领语义见 `claimDeath`，取舍见 docs/database.md。
 */
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

async function runDeathPhase(
  db: Database,
  gameId: string,
  options: DeathPhaseOptions,
): Promise<DeathPhaseResult> {
  const result: DeathPhaseResult = {
    settled: [],
    failed: [],
    appearanceFailed: [],
    dropped: [],
    dropFailed: [],
  };
  const { service, logger, trace } = options;

  const stageIds = await listStageIdsOfGame(db, gameId);
  if (stageIds.length === 0) {
    return result;
  }

  // 复活或外部写入把 hp 抬回正数时清标记，等下次死亡重新宣布。
  await resetRevivedDeathMarkers(db, stageIds);
  const dying = await listDeathsToSettle(db, gameId);

  const settled: typeof dying = [];
  await Promise.all(
    dying.map(async (actor) => {
      try {
        if (await announceDeath(db, gameId, actor, trace)) {
          result.settled.push(actor.name);
          settled.push(actor);
          await traceEvent(trace, {
            event: "phase",
            name: "death",
            status: "ok",
            actorName: actor.name,
          });
        }
      } catch (error) {
        // 事务回滚会连认领一起回滚，所以失败仍然可以重试。
        result.failed.push({ actorName: actor.name, reason: describeError(error) });
        logger?.warn(`死亡宣布失败，下次调用会重试: ${actor.name}`, error);
        await traceEvent(trace, {
          event: "phase",
          name: "death",
          status: "failed",
          actorName: actor.name,
          detail: { reason: describeError(error) },
        });
      }
    }),
  );

  // 只补宣布成功的死者；输了认领的那份已由别处收尾。
  if (service) {
    await Promise.all(
      settled.map(async (actor) => {
        try {
          const appearance = await refreshCorpseAppearance(db, gameId, actor.name, {
            service,
            ...(trace ? { trace } : {}),
          });
          if (!appearance.ok) {
            result.appearanceFailed.push(actor.name);
          }
          await traceEvent(trace, {
            event: "phase",
            name: "appearance",
            status: appearance.ok ? "ok" : "failed",
            actorName: actor.name,
          });
        } catch (error) {
          result.appearanceFailed.push(actor.name);
          logger?.warn(`尸体外观快照失败: ${actor.name}`, error);
          await traceEvent(trace, {
            event: "phase",
            name: "appearance",
            status: "failed",
            actorName: actor.name,
            detail: { reason: describeError(error) },
          });
        }
      }),
    );
    // 排在外观之后：掉落要读到刚写下的尸体描写。
    await Promise.all(
      settled.map(async (actor) => {
        try {
          const drop = await runDropTurn(db, gameId, actor.name, {
            service,
            ...(trace ? { trace } : {}),
          });
          if (!drop.ok) {
            result.dropFailed.push(actor.name);
            await traceEvent(trace, {
              event: "phase",
              name: "drop",
              status: "failed",
              actorName: actor.name,
            });
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
          result.dropFailed.push(actor.name);
          logger?.warn(`尸体掉落失败: ${actor.name}`, error);
          await traceEvent(trace, {
            event: "phase",
            name: "drop",
            status: "failed",
            actorName: actor.name,
            detail: { reason: describeError(error) },
          });
        }
      }),
    );
  }

  return result;
}
