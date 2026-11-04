import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, max } from "drizzle-orm";
import type { Database } from "../db/pool";
import {
  actors,
  gameMessages,
  gamePlayers,
  games,
  items,
  stageConnections,
  stageItems,
  stages,
  stageVisits,
  users,
  worlds,
} from "../db/schema";
import { dumpSystemPrompts } from "../debug/prompt-dump";
import type { Logger } from "../logging";
import { buildAffixSystemPrompt } from "./affixes";
import { toStats } from "./attributes";
import { buildCompactSystemPrompt } from "./compact";
import { buildDialogueAuditSystemPrompt } from "./dialogue-audit";
import { buildDropSystemPrompt } from "./drops";
import { assertEdgeShape } from "./edges";
import { GameError } from "./errors";
import { resolveAppearance } from "./form";
import { toItemState } from "./items";
import {
  buildActorSystemPrompt,
  buildStageSystemPrompt,
  buildWorldSystemPrompt,
  createActorMemory,
  createStageMemory,
  createWorldMemory,
} from "./memory";
import { recordAppearance } from "./persistence/appearances";
import { allocateEntitySeq } from "./persistence/entity-seq";
import { listSignatureNames, upsertSignatureName } from "./persistence/signature-names";
import { insertSignature, listCurrentSignatureViews } from "./persistence/signatures";
import { recordStageVisit } from "./persistence/visits";
import { buildStorySystemPrompt } from "./story";
import type {
  ActorState,
  ConnectionState,
  CreateGameInput,
  GameState,
  GameStateSlice,
  ItemState,
  MessageState,
  MessageVisibility,
  PlayerState,
  SignatureNameState,
  StageState,
  StageVisitState,
  World,
} from "./types";
import { parseWorldContent } from "./world-content";

type Reader = Pick<Database, "select">;
type GameRow = typeof games.$inferSelect;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** 按 slug 或 UUID 查找游戏；slug 跨用户不唯一时要求使用 id。 */
async function findGame(db: Reader, ref: string): Promise<GameRow | undefined> {
  const bySlug = await db.select().from(games).where(eq(games.slug, ref)).limit(2);
  if (bySlug.length > 1) {
    throw new GameError("invalid_action", `游戏 slug 不唯一，请使用 id: ${ref}`);
  }
  if (bySlug[0]) {
    return bySlug[0];
  }
  if (!UUID_PATTERN.test(ref)) {
    return undefined;
  }
  const byId = await db.select().from(games).where(eq(games.id, ref)).limit(1);
  return byId[0];
}

function iso(value: Date): string {
  return value.toISOString();
}

/** 读取一局游戏的完整状态（含公共事件流）；游戏不存在时抛出 GameError。 */
export async function getGameState(db: Database, ref: string): Promise<GameState> {
  const slice = await getGameStateSlice(db, ref);
  return { ...slice, messages: await listGameMessages(db, slice.game.id) };
}

/**
 * 读取活状态：world、stages、actors、items、visits 与签名称呼，不含公共事件流。
 *
 * 判定与提示词渲染只依赖这些字段；公共事件流交给控制面单独取，长局的读取代价才不会
 * 随事件数增长。内部查询的依赖只有 5 层，所以按层并发，不必 12 条串行。
 */
export async function getGameStateSlice(db: Database, ref: string): Promise<GameStateSlice> {
  const game = await findGame(db, ref);
  if (!game) {
    throw new GameError("not_found", `游戏不存在: ${ref}`);
  }

  const [[playerRow], [worldRow]] = await Promise.all([
    db
      .select({
        id: gamePlayers.id,
        userId: gamePlayers.userId,
        role: gamePlayers.role,
        username: users.username,
        displayName: users.displayName,
      })
      .from(gamePlayers)
      .innerJoin(users, eq(gamePlayers.userId, users.id))
      .where(eq(gamePlayers.gameId, game.id))
      .limit(1),
    db.select().from(worlds).where(eq(worlds.gameId, game.id)).limit(1),
  ]);
  if (!playerRow) {
    throw new GameError("invalid_state", `游戏缺少 player: ${game.id}`);
  }
  if (!worldRow) {
    throw new GameError("invalid_state", `游戏缺少 world: ${game.id}`);
  }

  const [stageRows, connectionRows, signatureNameRows] = await Promise.all([
    db
      .select()
      .from(stages)
      .where(eq(stages.worldId, worldRow.id))
      .orderBy(asc(stages.ordinal), asc(stages.createdAt)),
    db
      .select()
      .from(stageConnections)
      .where(eq(stageConnections.worldId, worldRow.id))
      .orderBy(asc(stageConnections.createdAt)),
    listSignatureNames(db, game.id),
  ]);
  const stageIds = stageRows.map((stage) => stage.id);

  const actorRows =
    stageIds.length === 0
      ? []
      : await db
          .select()
          .from(actors)
          .where(inArray(actors.stageId, stageIds))
          .orderBy(asc(actors.seq));
  const actorIds = actorRows.map((actor) => actor.id);

  const [visitRows, itemRows, signatureViews, stageItemRows] = await Promise.all([
    actorIds.length === 0
      ? []
      : db
          .select()
          .from(stageVisits)
          .where(and(eq(stageVisits.gameId, game.id), inArray(stageVisits.actorId, actorIds)))
          .orderBy(asc(stageVisits.firstVisitedAt)),
    actorIds.length === 0
      ? []
      : db.select().from(items).where(inArray(items.actorId, actorIds)).orderBy(asc(items.seq)),
    // 每个 actor 当前只有一条签名；外观由该签名的当前渲染行提供。
    listCurrentSignatureViews(db, actorIds),
    stageIds.length === 0
      ? []
      : db
          .select()
          .from(stageItems)
          .where(inArray(stageItems.stageId, stageIds))
          .orderBy(asc(stageItems.seq)),
  ]);

  // 同一回合的多次到达共享同一个 `now`，只按时间排序会让并列项顺序不稳定；
  // 并列时按场景序号（world 内的 ordinal）兜底，保证读出的顺序可复现。
  const stageOrdinal = new Map(stageRows.map((stage) => [stage.id, stage.ordinal]));
  const ordinalOf = (stageId: string): number => {
    const ordinal = stageOrdinal.get(stageId);
    // 到访记录由外键指向 stages，actor 又属于本 world，所以这里不可能缺失；
    // 真缺失说明数据被改坏，宁可当场炸，也不排序成 0 悄悄混进列表开头。
    assert(ordinal !== undefined, `访问历史指向了本局之外的场景: ${stageId}`);
    return ordinal;
  };
  const visits: StageVisitState[] = visitRows
    .map((visit) => ({
      actorId: visit.actorId,
      stageId: visit.stageId,
      firstVisitedAt: visit.firstVisitedAt.toISOString(),
      lastVisitedAt: visit.lastVisitedAt.toISOString(),
    }))
    .sort(
      (left, right) =>
        left.firstVisitedAt.localeCompare(right.firstVisitedAt) ||
        ordinalOf(left.stageId) - ordinalOf(right.stageId) ||
        left.actorId.localeCompare(right.actorId),
    );

  const signatureByActor = new Map(
    signatureViews.map(({ signature, appearance }) => [
      signature.actorId,
      { signature, appearance },
    ]),
  );

  const itemsByStage = new Map<string, ItemState[]>();
  for (const item of stageItemRows) {
    const list = itemsByStage.get(item.stageId) ?? [];
    list.push(toItemState(item));
    itemsByStage.set(item.stageId, list);
  }

  const itemsByActor = new Map<string, ItemState[]>();
  for (const item of itemRows) {
    const list = itemsByActor.get(item.actorId) ?? [];
    list.push(toItemState(item));
    itemsByActor.set(item.actorId, list);
  }

  const actorsByStage = new Map<string, ActorState[]>();
  for (const actor of actorRows) {
    const view = signatureByActor.get(actor.id);
    if (!view) {
      throw new GameError("invalid_state", `actor 缺少签名: ${actor.name}`);
    }
    const list = actorsByStage.get(actor.stageId) ?? [];
    list.push({
      id: actor.id,
      seq: actor.seq,
      key: actor.key,
      name: actor.name,
      profile: actor.profile,
      appearance: { id: view.appearance.id, text: view.appearance.text },
      signature: {
        id: view.signature.id,
        seq: view.signature.seq,
        form: view.signature.form,
      },
      stats: actor.stats,
      hp: actor.hp,
      isDefaultPlayer: actor.isDefaultPlayer,
      equipment: actor.equipment,
      items: itemsByActor.get(actor.id) ?? [],
      actions: actor.actions,
    });
    actorsByStage.set(actor.stageId, list);
  }

  const stageState: StageState[] = stageRows.map((stage) => ({
    id: stage.id,
    seq: stage.seq,
    key: stage.key ?? stage.name,
    name: stage.name,
    profile: stage.profile,
    environment: stage.environment,
    anchors: stage.anchors,
    ordinal: stage.ordinal,
    teleportBlocked: stage.teleportBlocked,
    actors: actorsByStage.get(stage.id) ?? [],
    items: itemsByStage.get(stage.id) ?? [],
    actions: stage.actions,
  }));

  const connections: ConnectionState[] = connectionRows.map((connection) => ({
    id: connection.id,
    fromStageId: connection.fromStageId,
    toStageId: connection.toStageId,
    passage: connection.passage,
  }));

  const player: PlayerState = {
    id: playerRow.id,
    userId: playerRow.userId,
    username: playerRow.username,
    displayName: playerRow.displayName,
    role: playerRow.role,
  };

  const signatureNames: SignatureNameState[] = signatureNameRows.map((row) => ({
    observerActorId: row.observerActorId,
    signatureId: row.signatureId,
    name: row.name,
    source: row.source,
    learnedStageId: row.learnedStageId,
  }));

  return {
    game: {
      id: game.id,
      ownerId: game.ownerId,
      name: game.name,
      slug: game.slug,
      status: game.status,
      outcome: game.outcome ?? null,
      contentVersion: game.contentVersion,
      version: game.version,
      createdAt: iso(game.createdAt),
      updatedAt: iso(game.updatedAt),
    },
    player,
    world: {
      id: worldRow.id,
      seq: worldRow.seq,
      name: worldRow.name,
      contentKey: worldRow.contentKey,
      profile: worldRow.profile,
      campaignSetting: worldRow.campaignSetting,
      globalRules: worldRow.globalRules,
      worldFunctions: worldRow.worldFunctions,
      actions: worldRow.actions,
      stages: stageState,
      connections,
    },
    signatureNames,
    visits: visits,
  };
}

export type GameMessageQuery = {
  /** 只取序号大于它的消息；用于增量推进。 */
  afterSequence?: number;
  /** 单次上限，按 `sequence` 升序取前 N 条。 */
  limit?: number;
};

/**
 * 公共事件流；按 `sequence` 升序，可选择增量与条数上限。
 *
 * 控制面才需要它：回合交付、快照、事件回顾。判定路径读 `getGameStateSlice`。
 */
export async function listGameMessages(
  db: Database,
  gameId: string,
  query: GameMessageQuery = {},
): Promise<MessageState[]> {
  const conditions = [eq(gameMessages.gameId, gameId)];
  if (query.afterSequence !== undefined) {
    conditions.push(gt(gameMessages.sequence, query.afterSequence));
  }
  const select = db
    .select()
    .from(gameMessages)
    .where(and(...conditions))
    .orderBy(asc(gameMessages.sequence));
  const rows = query.limit === undefined ? await select : await select.limit(query.limit);
  return rows.map((message) => ({
    id: message.id,
    sequence: message.sequence,
    kind: message.kind,
    stageId: message.stageId,
    sourceActorId: message.sourceActorId,
    targetActorId: message.targetActorId,
    visibility: message.visibility as MessageVisibility,
    content: message.content,
    createdAt: iso(message.createdAt),
  }));
}

/** 公共事件流当前的最大 `sequence`；空事件流为 0。 */
export async function latestMessageSequence(db: Database, gameId: string): Promise<number> {
  const [row] = await db
    .select({ sequence: max(gameMessages.sequence) })
    .from(gameMessages)
    .where(eq(gameMessages.gameId, gameId));
  // `max()` 在空表上返回 null，这里不是错误：只是还没有任何公共事件。
  return row?.sequence ?? 0;
}

/**
 * 回合结束时的交付：活状态切片 + 事件流游标，两条查询互不依赖，一起发。
 *
 * 状态与游标各自独立成形，调用方拿游标按 `afterSequence` 增量拉本回合的事件流。
 */
export async function readTurnDelivery(
  db: Database,
  gameId: string,
): Promise<{ state: GameStateSlice; messageCursor: number }> {
  const [state, messageCursor] = await Promise.all([
    getGameStateSlice(db, gameId),
    latestMessageSequence(db, gameId),
  ]);
  return { state, messageCursor };
}

export type GameMeta = {
  id: string;
  slug: string;
  status: string;
  contentVersion: string;
  version: number;
  playerId: string;
};

/** 只读游戏与玩家 id 的最小信息；给控制类调用方用，不装配世界。 */
export async function getGameMeta(db: Database, ref: string): Promise<GameMeta> {
  const game = await findGame(db, ref);
  if (!game) {
    throw new GameError("not_found", `游戏不存在: ${ref}`);
  }
  const [playerRow] = await db
    .select({ id: gamePlayers.id })
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, game.id))
    .limit(1);
  if (!playerRow) {
    throw new GameError("invalid_state", `游戏缺少 player: ${game.id}`);
  }
  return {
    id: game.id,
    slug: game.slug,
    status: game.status,
    contentVersion: game.contentVersion,
    version: game.version,
    playerId: playerRow.id,
  };
}

/**
 * 按 actor 真名解析 id 与所在场景；不装配 world。
 *
 * 语义与 `findActorByName` 一致：名字重复直接拒绝，不退回 id 或编号。
 */
export async function resolveActorIdByName(
  db: Database,
  gameId: string,
  name: string,
): Promise<{ id: string; name: string; stageId: string; seq: number }> {
  const rows = await db
    .select({ id: actors.id, name: actors.name, stageId: actors.stageId, seq: actors.seq })
    .from(actors)
    .innerJoin(stages, eq(actors.stageId, stages.id))
    .innerJoin(worlds, eq(stages.worldId, worlds.id))
    .where(and(eq(worlds.gameId, gameId), eq(actors.name, name)))
    .limit(2);
  if (rows.length === 0) {
    throw new GameError("not_found", `actor 不存在: ${name}`);
  }
  if (rows.length > 1) {
    throw new GameError("invalid_action", `actor 名称不唯一: ${name}`);
  }
  const [row] = rows;
  assert(row, `actor 定位结果为空: ${name}`);
  return row;
}

/** 创建一局游戏及初始 world、stage、actor、item 与 memory。 */
export async function createGame(
  db: Database,
  input: CreateGameInput,
  options: { logger?: Logger } = {},
): Promise<GameState> {
  input = { ...input, world: parseWorldContent(input.world) };
  const gameId = randomUUID();
  const gameName = input.name?.trim() || input.world.worldName;
  const requestedSlug = input.slug?.trim();
  const baseSlug = slugify(requestedSlug ?? gameName);
  if (requestedSlug !== undefined && baseSlug.length === 0) {
    throw new GameError("invalid_action", `slug 不能为空或只包含非 ASCII 字符: ${requestedSlug}`);
  }
  const slug = requestedSlug ? baseSlug : `${baseSlug || "game"}-${gameId.slice(0, 8)}`;

  // 建局时收集最终 system prompt，事务提交后导出为人类可读的 md。
  const stagePrompts: { name: string; prompt: string }[] = [];
  const actorPrompts: { name: string; prompt: string }[] = [];
  const worldPrompt = buildWorldSystemPrompt(input.world);

  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.username, input.username)).limit(1);
    if (!user) {
      throw new GameError("not_found", `用户不存在: ${input.username}`);
    }

    const playerId = randomUUID();
    const worldId = randomUUID();

    await tx.insert(games).values({
      id: gameId,
      ownerId: user.id,
      slug,
      name: gameName,
      status: "active",
      contentVersion: input.world.contentVersion,
      version: 0,
    });

    await tx.insert(gamePlayers).values({
      id: playerId,
      gameId,
      userId: user.id,
      role: "player",
    });

    await tx.insert(worlds).values({
      id: worldId,
      seq: await allocateEntitySeq(tx, gameId),
      gameId,
      name: input.world.worldName,
      contentKey: input.world.contentKey,
      profile: input.world.profile,
      campaignSetting: input.world.campaignSetting,
      globalRules: input.world.globalRules,
      worldFunctions: input.world.worldFunctions,
      actions: [...input.world.actions],
    });
    await createWorldMemory(
      tx,
      gameId,
      {
        id: worldId,
        worldName: input.world.worldName,
        campaignSetting: input.world.campaignSetting,
        globalRules: input.world.globalRules,
      },
      worldPrompt,
    );

    const stageIds = new Map<string, string>();
    for (const [ordinal, stage] of input.world.stages.entries()) {
      if (stageIds.has(stage.key)) {
        throw new GameError("invalid_state", `重复的 stage key: ${stage.key}`);
      }
      const stageId = randomUUID();
      stageIds.set(stage.key, stageId);
      await tx.insert(stages).values({
        id: stageId,
        seq: await allocateEntitySeq(tx, gameId),
        worldId,
        key: stage.key,
        name: stage.name,
        profile: stage.profile,
        environment: stage.environment,
        anchors: stage.anchors ? [...stage.anchors] : [],
        actions: [...stage.actions],
        teleportBlocked: stage.teleportBlocked ?? false,
        ordinal,
      });

      const stagePrompt = buildStageSystemPrompt(
        {
          name: input.world.worldName,
          campaignSetting: input.world.campaignSetting,
          globalRules: input.world.globalRules,
        },
        stage,
      );
      stagePrompts.push({ name: stage.name, prompt: stagePrompt });
      await createStageMemory(
        tx,
        gameId,
        { id: stageId, name: stage.name, profile: stage.profile },
        stagePrompt,
      );

      for (const item of stage.items ?? []) {
        await tx.insert(stageItems).values({
          id: randomUUID(),
          seq: await allocateEntitySeq(tx, gameId),
          stageId,
          key: item.key,
          name: item.name,
          description: item.description,
          kind: item.kind,
          source: item.source ?? null,
          count: item.count ?? 1,
          stats: toStats(item.stats),
          effect: item.effect,
          affixes: [...(item.affixes ?? [])],
          actions: [...(item.actions ?? [])],
        });
      }
    }

    // 物品 key 必须全局唯一；行为引用的 stage key 必须存在于本世界。
    const itemKeys = new Set<string>();
    const allItems = [
      ...input.world.stages.flatMap((item) => item.items ?? []),
      ...input.world.actors.flatMap((actor) => actor.items),
    ];
    for (const item of allItems) {
      if (item.key.trim().length === 0) {
        throw new GameError("invalid_state", "物品 key 不能为空");
      }
      if (itemKeys.has(item.key)) {
        throw new GameError("invalid_state", `重复的物品 key: ${item.key}`);
      }
      itemKeys.add(item.key);
    }

    // actor key 是内容层引用角色的唯一方式，必须全局唯一。
    const actorKeys = new Set<string>();
    for (const actor of input.world.actors) {
      if (actorKeys.has(actor.key)) {
        throw new GameError("invalid_state", `重复的 actor key: ${actor.key}`);
      }
      actorKeys.add(actor.key);
    }

    for (const connection of input.world.connections) {
      const fromStageId = stageIds.get(connection.from);
      const toStageId = stageIds.get(connection.to);
      if (!fromStageId || !toStageId) {
        throw new GameError(
          "invalid_state",
          `连接引用了不存在的 stage: ${connection.from} -> ${connection.to}`,
        );
      }
      assertEdgeShape(fromStageId, toStageId);
      await tx.insert(stageConnections).values({
        id: randomUUID(),
        worldId,
        fromStageId,
        toStageId,
        passage: connection.passage ?? "open",
      });
    }

    // 建局是一次写入：外观与起始到访共享同一个时间戳，免得同一批数据出现先后差异。
    const now = new Date();
    const actorRefs = new Map<string, { actorId: string; signatureId: string; name: string }>();
    for (const actor of input.world.actors) {
      const actorStageId = stageIds.get(actor.stageKey);
      if (!actorStageId) {
        throw new GameError("invalid_state", `actor 引用了不存在的 stage: ${actor.stageKey}`);
      }

      const actorId = randomUUID();
      const stats = toStats(actor.stats);
      // 内容只声明 hp：hp 为 0 就是尸体，没有单独的死亡状态可写。
      const hp = actor.hp ?? stats.maxHp;
      await tx.insert(actors).values({
        id: actorId,
        seq: await allocateEntitySeq(tx, gameId),
        stageId: actorStageId,
        key: actor.key,
        name: actor.name,
        profile: actor.profile,
        stats,
        hp,
        isDefaultPlayer: actor.isDefaultPlayer ?? false,
        equipment: actor.equipment ?? {},
        actions: [...actor.actions],
      });

      // 开局只有一个签名。伪装 / 变身之后才会插入新签名。
      const signatureId = randomUUID();
      await insertSignature(tx, {
        id: signatureId,
        seq: await allocateEntitySeq(tx, gameId),
        actorId,
        form: actor.signature.form,
      });
      await recordAppearance(tx, {
        gameId,
        actorId,
        text: resolveAppearance(actor.signature),
        input: {
          version: 1,
          source: "seed",
          contentKey: input.world.contentKey,
          contentVersion: input.world.contentVersion,
          actorKey: actor.key,
          form: actor.signature.form,
          fallback: !actor.signature.appearance?.trim(),
        },
        now,
      });
      actorRefs.set(actor.key, { actorId, signatureId, name: actor.name });

      for (const item of actor.items) {
        await tx.insert(items).values({
          id: randomUUID(),
          seq: await allocateEntitySeq(tx, gameId),
          actorId,
          key: item.key,
          name: item.name,
          description: item.description,
          kind: item.kind,
          source: item.source ?? null,
          count: item.count ?? 1,
          stats: toStats(item.stats),
          effect: item.effect,
          affixes: [...(item.affixes ?? [])],
          actions: [...(item.actions ?? [])],
        });
      }

      const actorPrompt = buildActorSystemPrompt(
        {
          id: worldId,
          name: input.world.worldName,
          campaignSetting: input.world.campaignSetting,
          globalRules: input.world.globalRules,
        },
        { name: actor.name, profile: actor.profile, form: actor.signature.form },
      );
      actorPrompts.push({ name: actor.name, prompt: actorPrompt });
      await createActorMemory(
        tx,
        gameId,
        {
          id: actorId,
          name: actor.name,
          profile: actor.profile,
          openingBriefing: actor.openingBriefing,
          form: actor.signature.form,
        },
        actorPrompt,
      );
      // 开局即在起始场景：起点算一次到访，起点名字从一开始就是 actor 的知识。
      await recordStageVisit(tx, gameId, actorId, actorStageId, now);
    }

    // 开局名字绑定：观察者与对象都用内容 key 引用，落库时变成 actor / 签名 id。
    for (const binding of input.world.signatureNames ?? []) {
      const observer = actorRefs.get(binding.observer);
      const subject = actorRefs.get(binding.subject);
      if (!observer) {
        throw new GameError(
          "invalid_state",
          `signatureNames 引用了不存在的观察者: ${binding.observer}`,
        );
      }
      if (!subject) {
        throw new GameError(
          "invalid_state",
          `signatureNames 引用了不存在的对象: ${binding.subject}`,
        );
      }
      if (observer.actorId === subject.actorId) {
        throw new GameError(
          "invalid_state",
          `signatureNames 不能把自己记作他人: ${binding.observer}`,
        );
      }
      await upsertSignatureName(
        tx,
        {
          gameId,
          observerActorId: observer.actorId,
          signatureId: subject.signatureId,
          name: binding.name,
          source: "content",
          learnedStageId: null,
        },
        new Date(),
      );
    }
  });

  /** 世界职能系统的真实入口：与运行时同一份拼装，导出才不会是另写的副本。 */
  function buildFunctionPrompts(world: World): { name: string; prompt: string }[] {
    const constitution = { name: world.worldName, ...world };
    return [
      { name: "drops", prompt: buildDropSystemPrompt(constitution) },
      { name: "affixes", prompt: buildAffixSystemPrompt(constitution) },
      { name: "story", prompt: buildStorySystemPrompt(constitution) },
      { name: "compact", prompt: buildCompactSystemPrompt(constitution) },
      { name: "dialogue-audit", prompt: buildDialogueAuditSystemPrompt(constitution) },
    ];
  }

  await dumpSystemPrompts({
    world: { name: input.world.worldName, contentVersion: input.world.contentVersion },
    worldPrompt,
    functionPrompts: buildFunctionPrompts(input.world),
    stagePrompts,
    actorPrompts,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return getGameState(db, gameId);
}
