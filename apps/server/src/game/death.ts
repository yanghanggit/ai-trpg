import type { Database } from "../db/pool";
import type { LlmLogger } from "../llm/logger";
import type { ChatCompletionService } from "../llm/protocol";
import { runAppearanceTurn } from "./appearance";
import { appendPublicMessage, bumpGameVersion } from "./apply/messages";
import { MEMORY_KINDS } from "./constants";
import { completeGame } from "./end-game";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { appendActionObservations, appendStageEvent } from "./observations";
import { listActorsForAppearance } from "./persistence/actors";
import {
  claimDeath,
  listDeadDefaultPlayers,
  listDeathsToSettle,
  listStageIdsOfGame,
  resetRevivedDeathMarkers,
} from "./persistence/deaths";
import type { DeathPhaseFailure, DeathPhaseResult } from "./types";

export type DeathPhaseOptions = {
  /** 只有尸体外观快照需要 LLM；不传就跳过外观。 */
  service?: ChatCompletionService;
  logger?: LlmLogger;
};

/** 同一局的并发调用合流到同一次扫描。 */
const running = new Map<string, Promise<DeathPhaseResult>>();

/**
 * 死亡阶段：把「`hp` 归零但还没宣布」的死者各收尾一次。
 *
 * 由 hp 变化的调用方在事务之后触发，也可显式调用。顺序固定为 宣布 → 尸体外观 → 结束整局：
 * 外观推理只服务 active 局。
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
  const result: DeathPhaseResult = { settled: [], failed: [], appearanceFailed: [] };
  const { service, logger } = options;

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
        if (await announceDeath(db, gameId, actor)) {
          result.settled.push(actor.name);
          settled.push(actor);
        }
      } catch (error) {
        // 事务回滚会连认领一起回滚，所以失败仍然可以重试。
        result.failed.push({ actorName: actor.name, reason: describeError(error) });
        logger?.warn(`死亡宣布失败，下次调用会重试: ${actor.name}`, error);
      }
    }),
  );

  // 只补宣布成功的死者；输了认领的那份已由别处收尾。
  if (service) {
    await Promise.all(
      settled.map(async (actor) => {
        try {
          const appearance = await runAppearanceTurn(db, gameId, actor.id, { service });
          if (!appearance.ok) {
            result.appearanceFailed.push(actor.name);
          }
        } catch (error) {
          result.appearanceFailed.push(actor.name);
          logger?.warn(`尸体外观快照失败: ${actor.name}`, error);
        }
      }),
    );
  }

  // 与宣布解耦：不靠结算方记得调用，任何写 hp 的路径都由这里收口。
  for (const player of await listDeadDefaultPlayers(db, gameId)) {
    try {
      await completeGame(db, gameId, `${player.name}倒下了。故事就此结束。`, {
        stageId: player.stageId,
      });
    } catch (error) {
      result.failed.push({ actorName: player.name, reason: describeError(error) });
      logger?.warn(`结束整局失败，下次调用会重试: ${player.name}`, error);
    }
  }

  return result;
}

/** 宣布一个 actor 死亡；认领失败（别人已宣布，或死者刚复活）时返回 false。 */
async function announceDeath(
  db: Database,
  gameId: string,
  actor: { id: string; name: string; stageId: string },
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
    await appendStageEvent(tx, gameId, actor.stageId, `# 生命事件\n${actor.name}的生命归零。`, {
      eventKind: "death",
      targetActorId: actor.id,
    });
    await appendActionObservations(tx, gameId, actor.stageId, actor.id, `# 场景动态\n${content}`);
    // 死者自己也留一条：复活类扩展需要知道「我死过」。
    const memory = await loadAgentMemory(tx, gameId, "actor", actor.id);
    if (memory) {
      await appendMemoryMessages(tx, memory.row.id, [
        {
          type: "human",
          content: "# 你的生命归零\n你已经死亡。",
          metadata: { kind: MEMORY_KINDS.actionObservation, stageId: actor.stageId },
        },
      ]);
    }
    await bumpGameVersion(tx, gameId, now);
    return true;
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type AppearanceMaintenanceResult = {
  /** 本次重推了外观的活人。 */
  refreshed: string[];
  /** 本次宣布死亡的死者。 */
  settled: string[];
  /** 死亡阶段的失败（宣布或结束整局），需要重试。 */
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
