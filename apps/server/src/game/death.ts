import type { Database } from "../db/pool";
import { type TraceContext, traceEvent } from "../debug/trace";
import type { ChatCompletionService } from "../llm/protocol";
import type { Logger } from "../logging";
import { mentionOf } from "./addressing";
import { runAppearanceTurn } from "./appearance";
import { appendPublicMessage, bumpGameVersion } from "./apply/messages";
import { MEMORY_KINDS } from "./constants";
import { runDropTurn } from "./drops";
import { GameError } from "./errors";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { renderAction, withAppearances } from "./observation-text";
import {
  appendCustomStageObservation,
  appendSelfObservation,
  appendStageMemory,
} from "./observations";
import { listActorsForAppearance } from "./persistence/actors";
import {
  claimDeath,
  listDeathsToSettle,
  listStageIdsOfGame,
  resetRevivedDeathMarkers,
} from "./persistence/deaths";
import { loadWorldByGame } from "./persistence/worlds";
import type { DeathPhaseFailure, DeathPhaseResult } from "./types";

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
          const appearance = await runAppearanceTurn(db, gameId, actor.id, {
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
          const drop = await runDropTurn(db, gameId, actor.id, {
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

/** 宣布一个 actor 死亡；认领失败（别人已宣布，或死者刚复活）时返回 false。 */
async function announceDeath(
  db: Database,
  gameId: string,
  actor: { id: string; name: string; stageId: string; isDefaultPlayer: boolean },
  trace?: TraceContext,
): Promise<boolean> {
  const content = `${actor.name}倒下了，不再有任何生命迹象。`;
  const now = new Date();
  return db.transaction(async (tx) => {
    if (!(await claimDeath(tx, actor.id, now))) {
      return false;
    }
    await appendPublicMessage(tx, gameId, null, {
      kind: "death",
      stageId: actor.stageId,
      targetActorId: actor.id,
      visibility: "stage",
      content,
    });
    await appendStageMemory(
      tx,
      gameId,
      actor.stageId,
      `# 生命事件\n${actor.name}的生命归零。`,
      { eventKind: "death", targetActorId: actor.id },
      trace,
    );
    await appendCustomStageObservation(
      tx,
      gameId,
      actor.stageId,
      actor.id,
      (_observerId, address) =>
        renderAction(
          withAppearances(
            `# 场景动态\n${mentionOf(address(actor.id))}倒下了，不再有任何生命迹象。`,
            [address(actor.id)],
          ),
          actor.stageId,
        ),
      trace,
    );
    // 死者自己也留一条：复活类扩展需要知道「我死过」。
    await appendSelfObservation(
      tx,
      gameId,
      actor.stageId,
      actor.id,
      "# 你的生命归零\n你已经死亡。",
      {},
      trace,
    );
    if (actor.isDefaultPlayer) {
      await appendDefaultPlayerDeath(tx, gameId, actor);
    }
    await bumpGameVersion(tx, gameId, now);
    return true;
  });
}

/**
 * 主角死亡也走同一条通知通道：world 下一回合看到这条事实，自己决定怎么收尾。
 * 框架不替它写结局，也不在这里结束整局。
 */
async function appendDefaultPlayerDeath(
  executor: Parameters<typeof loadWorldByGame>[0],
  gameId: string,
  actor: { id: string; name: string; stageId: string },
): Promise<void> {
  const world = await loadWorldByGame(executor, gameId);
  if (!world) {
    throw new GameError("not_found", `游戏缺少 world: ${gameId}`);
  }
  const memory = await loadAgentMemory(executor, gameId, "world", world.id);
  if (!memory) {
    throw new GameError("invalid_state", `world 缺少 memory: ${world.id}`);
  }
  await appendMemoryMessages(executor, memory.row.id, [
    {
      type: "human",
      content: `# 主角死亡\n${actor.name}倒下了，生命归零。`,
      metadata: {
        kind: MEMORY_KINDS.worldEvent,
        stageId: actor.stageId,
        actorId: actor.id,
      },
    },
  ]);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    const appearance = await runAppearanceTurn(db, gameId, row.id, {
      service,
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
