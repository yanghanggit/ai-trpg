import { and, eq, gt, inArray, isNull, lte, not } from "drizzle-orm";
import type { Database } from "../db/pool";
import { actors, stages, worlds } from "../db/schema";
import type { ChatCompletionService } from "../llm/protocol";
import { runAppearanceTurn } from "./appearance";
import { appendPublicMessage, bumpGameVersion } from "./apply/messages";
import { MEMORY_KINDS } from "./constants";
import { appendMemoryMessages, loadAgentMemory } from "./memory";
import { appendActionObservations, appendStageEvent } from "./observations";

export type DeathPhaseOptions = {
  /** 死亡广播不需要 LLM；只有随后的外观快照需要，没给就跳过外观。 */
  service?: ChatCompletionService;
  logger?: Parameters<typeof runAppearanceTurn>[3]["logger"];
};

export type DeathPhaseResult = {
  /** 本次宣布死亡的 actor 名字。 */
  settled: string[];
  /** 死亡已经广播、但外观快照没推成的 actor；按设计可以放着不管。 */
  appearanceFailed: string[];
};

/**
 * 死亡阶段：扫描本局全部 actor，把「`hp` 已归零但还没宣布过」的死者各处理一次。
 *
 * 两个部分，顺序固定：
 * 1. **宣布死亡**（不需要 LLM，权威）：写公共事件、场景记忆、旁观者记忆与死者自己的记忆，
 *    并在同一个事务里写 `death_settled_at`。这一步完成，死亡就算处理完了。
 * 2. **尸体外观快照**（需要 LLM，尽力而为）：失败只记进 `appearanceFailed`，不回退第 1 步，
 *    也不重试——死者的外观留在死亡前的样子是可以接受的。
 *
 * 三条约定：
 * - 死亡不是状态字段，而是 `hp === 0` 这个事实；攻击方只写 hp，不判定死亡。
 * - 宣布与收尾属于死者自己，因此在 hp 变化的事务之后全局扫描，而不是塞进攻击方的结算里；
 *   每个死者彼此独立、并发执行。
 * - `death_settled_at` 只是「这次死亡已经宣布过了吗」的处理标记，不是生命状态；
 *   一旦 hp 被抬回正数（复活），标记会被清空，等下次死亡重新宣布。
 */
export async function settleDeaths(
  db: Database,
  gameId: string,
  options: DeathPhaseOptions = {},
): Promise<DeathPhaseResult> {
  const result: DeathPhaseResult = { settled: [], appearanceFailed: [] };
  const { service } = options;

  const stageIds = await stageIdsOf(db, gameId);
  if (stageIds.length === 0) {
    return result;
  }

  // 复活或外部写入把 hp 拉回正数时，清掉旧的收尾标记，等下次死亡重新宣布。
  await db
    .update(actors)
    .set({ deathSettledAt: null })
    .where(
      and(inArray(actors.stageId, stageIds), gt(actors.hp, 0), not(isNull(actors.deathSettledAt))),
    );

  const dying = await db
    .select({ id: actors.id, name: actors.name, stageId: actors.stageId })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .innerJoin(worlds, eq(stages.worldId, worlds.id))
    .where(and(eq(worlds.gameId, gameId), lte(actors.hp, 0), isNull(actors.deathSettledAt)));

  // 第一步：宣布死亡。只写库，没有 LLM；失败的死者不影响其它人。
  await Promise.all(
    dying.map(async (actor) => {
      try {
        await announceDeath(db, gameId, actor);
        result.settled.push(actor.name);
      } catch {
        // 连广播都没写成就跳过：标记没写，下一次 hp 变化或 `agent:game deaths` 会再来。
      }
    }),
  );

  // 第二步：尸体外观快照，尽力而为。失败不回退已宣布的死亡，也不重试。
  if (!service) {
    return result;
  }
  await Promise.all(
    dying.map(async (actor) => {
      try {
        const appearance = await runAppearanceTurn(db, gameId, actor.id, {
          service,
          ...(options.logger ? { logger: options.logger } : {}),
        });
        if (!appearance.ok) {
          result.appearanceFailed.push(actor.name);
        }
      } catch {
        result.appearanceFailed.push(actor.name);
      }
    }),
  );

  return result;
}

/** 宣布一个 actor 死亡：公共事件 + 场景记忆 + 旁观者记忆 + 死者自己的记忆 + 收尾标记。 */
async function announceDeath(
  db: Database,
  gameId: string,
  actor: { id: string; name: string; stageId: string },
): Promise<void> {
  const content = `${actor.name}倒下了，不再有任何生命迹象。`;
  const now = new Date();
  await db.transaction(async (tx) => {
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
    await tx
      .update(actors)
      .set({ deathSettledAt: now, updatedAt: now })
      .where(eq(actors.id, actor.id));
  });
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
  /** 本次宣布死亡的死者。 */
  settled: string[];
  /** 死亡已广播、但外观快照没推成的死者。 */
  appearanceFailed: string[];
  /** 已宣布过死亡、被批量入口跳过的尸体；要重推必须显式指定 actor。 */
  skipped: string[];
};

/**
 * 批量外观维护：活人各推一次；未宣布死亡的死者交给死亡阶段；已收尾的尸体跳过。
 *
 * 批量入口必须幂等——`hp` 只是"是不是死的"，判断不出"这次死亡宣布过没有"，
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
    appearanceFailed: [],
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
  result.appearanceFailed = deathPhase.appearanceFailed;
  return result;
}
