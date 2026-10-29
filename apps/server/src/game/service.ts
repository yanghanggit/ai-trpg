import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
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
import { toStats } from "./attributes";
import { resolveAppearance } from "./body";
import { assertEdgeShape } from "./edges";
import { GameError } from "./errors";
import { toItemState } from "./items";
import {
  buildActorSystemPrompt,
  buildStageSystemPrompt,
  buildWorldSystemPrompt,
  createActorMemory,
  createStageMemory,
  createWorldMemory,
} from "./memory";
import { allocateEntitySeq } from "./persistence/entity-seq";
import { listKnowledge, upsertKnowledge } from "./persistence/knowledge";
import { insertPresentation, listCurrentPresentations } from "./persistence/presentations";
import type {
  ActorState,
  ConnectionState,
  CreateGameInput,
  GameState,
  ItemState,
  MessageState,
  MessageVisibility,
  NameKnowledgeState,
  PlayerState,
  StageState,
  StageVisitState,
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

/** 读取一局游戏的完整状态；游戏不存在时抛出 GameError。 */
export async function getGameState(db: Database, ref: string): Promise<GameState> {
  const game = await findGame(db, ref);
  if (!game) {
    throw new GameError("not_found", `游戏不存在: ${ref}`);
  }

  const [playerRow] = await db
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
    .limit(1);
  if (!playerRow) {
    throw new GameError("invalid_state", `游戏缺少 player: ${game.id}`);
  }

  const [worldRow] = await db.select().from(worlds).where(eq(worlds.gameId, game.id)).limit(1);
  if (!worldRow) {
    throw new GameError("invalid_state", `游戏缺少 world: ${game.id}`);
  }

  const stageRows = await db
    .select()
    .from(stages)
    .where(eq(stages.worldId, worldRow.id))
    .orderBy(asc(stages.ordinal), asc(stages.createdAt));
  const stageIds = stageRows.map((stage) => stage.id);

  const connectionRows =
    stageIds.length === 0
      ? []
      : await db
          .select()
          .from(stageConnections)
          .where(eq(stageConnections.worldId, worldRow.id))
          .orderBy(asc(stageConnections.createdAt));

  const actorRows =
    stageIds.length === 0
      ? []
      : await db
          .select()
          .from(actors)
          .where(inArray(actors.stageId, stageIds))
          .orderBy(asc(actors.seq));
  const actorIds = actorRows.map((actor) => actor.id);

  const visitRows =
    actorIds.length === 0
      ? []
      : await db
          .select()
          .from(stageVisits)
          .where(and(eq(stageVisits.gameId, game.id), inArray(stageVisits.actorId, actorIds)))
          .orderBy(asc(stageVisits.firstVisitedAt));

  const visits: StageVisitState[] = visitRows.map((visit) => ({
    actorId: visit.actorId,
    stageId: visit.stageId,
    firstVisitedAt: visit.firstVisitedAt.toISOString(),
    lastVisitedAt: visit.lastVisitedAt.toISOString(),
  }));

  const itemRows =
    actorIds.length === 0
      ? []
      : await db
          .select()
          .from(items)
          .where(inArray(items.actorId, actorIds))
          .orderBy(asc(items.seq));

  // 每个 actor 当前只有一条形象；运行时快照把展示值拍平到 appearance，
  // 这里只把句柄与识别需要的字段带出来。
  const presentationRows = await listCurrentPresentations(db, actorIds);
  const presentationByActor = new Map(presentationRows.map((row) => [row.actorId, row]));

  const stageItemRows =
    stageIds.length === 0
      ? []
      : await db
          .select()
          .from(stageItems)
          .where(inArray(stageItems.stageId, stageIds))
          .orderBy(asc(stageItems.seq));

  const itemsByStage = new Map<string, ItemState[]>();
  for (const item of stageItemRows) {
    const list = itemsByStage.get(item.stageId) ?? [];
    list.push(toItemState(item));
    itemsByStage.set(item.stageId, list);
  }

  const messageRows = await db
    .select()
    .from(gameMessages)
    .where(eq(gameMessages.gameId, game.id))
    .orderBy(asc(gameMessages.sequence));

  const itemsByActor = new Map<string, ItemState[]>();
  for (const item of itemRows) {
    const list = itemsByActor.get(item.actorId) ?? [];
    list.push(toItemState(item));
    itemsByActor.set(item.actorId, list);
  }

  const actorsByStage = new Map<string, ActorState[]>();
  for (const actor of actorRows) {
    const presentation = presentationByActor.get(actor.id);
    if (!presentation) {
      throw new GameError("invalid_state", `actor 缺少形象: ${actor.name}`);
    }
    const list = actorsByStage.get(actor.stageId) ?? [];
    list.push({
      id: actor.id,
      seq: actor.seq,
      key: actor.key,
      name: actor.name,
      profile: actor.profile,
      appearance: presentation.appearance,
      presentation: {
        id: presentation.id,
        seq: presentation.seq,
        anchor: presentation.anchor,
        isDefault: presentation.isDefault,
      },
      baseBody: actor.baseBody,
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

  const knowledgeRows = await listKnowledge(db, game.id);
  const knowledge: NameKnowledgeState[] = knowledgeRows.map((row) => ({
    observerActorId: row.observerActorId,
    presentationId: row.presentationId,
    name: row.name,
    source: row.source,
    learnedStageId: row.learnedStageId,
  }));

  const messages: MessageState[] = messageRows.map((message) => ({
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
      systemRules: worldRow.systemRules,
      actions: worldRow.actions,
      stages: stageState,
      connections,
    },
    messages,
    knowledge,
    visits,
  };
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
      systemRules: input.world.systemRules,
      actions: [...input.world.actions],
    });
    await createWorldMemory(
      tx,
      gameId,
      {
        id: worldId,
        worldName: input.world.worldName,
        campaignSetting: input.world.campaignSetting,
        systemRules: input.world.systemRules,
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
          systemRules: input.world.systemRules,
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

    const actorRefs = new Map<string, { actorId: string; presentationId: string }>();
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
        baseBody: actor.baseBody,
        stats,
        hp,
        isDefaultPlayer: actor.isDefaultPlayer ?? false,
        equipment: actor.equipment ?? {},
        actions: [...actor.actions],
      });

      // 开局只有一个默认形象：本相。伪装 / 变身之后才会插入新形象。
      const presentationId = randomUUID();
      await insertPresentation(tx, {
        id: presentationId,
        seq: await allocateEntitySeq(tx, gameId),
        actorId,
        anchor: actor.baseBody.description,
        appearance: resolveAppearance(actor),
        isDefault: true,
      });
      actorRefs.set(actor.key, { actorId, presentationId });

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
          systemRules: input.world.systemRules,
        },
        actor,
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
          baseBody: actor.baseBody,
        },
        actorPrompt,
      );
      await tx.insert(stageVisits).values({
        id: randomUUID(),
        gameId,
        actorId,
        stageId: actorStageId,
      });
    }

    // 开局既知的名字：观察者与对象都用内容 key 引用，落库时变成 actor / 形象 id。
    for (const identity of input.world.knownIdentities ?? []) {
      const observer = actorRefs.get(identity.observer);
      const subject = actorRefs.get(identity.subject);
      if (!observer) {
        throw new GameError(
          "invalid_state",
          `knownIdentities 引用了不存在的观察者: ${identity.observer}`,
        );
      }
      if (!subject) {
        throw new GameError(
          "invalid_state",
          `knownIdentities 引用了不存在的对象: ${identity.subject}`,
        );
      }
      if (observer.actorId === subject.actorId) {
        throw new GameError(
          "invalid_state",
          `knownIdentities 不能把自己记作他人: ${identity.observer}`,
        );
      }
      await upsertKnowledge(
        tx,
        {
          gameId,
          observerActorId: observer.actorId,
          presentationId: subject.presentationId,
          name: identity.name,
          source: "content",
          learnedStageId: null,
        },
        new Date(),
      );
    }
  });

  await dumpSystemPrompts({
    world: {
      name: input.world.worldName,
      contentVersion: input.world.contentVersion,
      campaignSetting: input.world.campaignSetting,
      systemRules: input.world.systemRules,
    },
    stagePrompts,
    actorPrompts,
    worldAgentPrompt: worldPrompt,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return getGameState(db, gameId);
}
