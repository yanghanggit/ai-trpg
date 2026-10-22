import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import {
  actors,
  gameMessages,
  gamePlayers,
  games,
  items,
  stageConnections,
  stages,
  users,
  worlds,
} from "../db/schema";
import { GameError } from "./errors";
import type {
  ActorState,
  ConnectionState,
  CreateGameInput,
  GameActionInput,
  GameState,
  ItemState,
  MessageState,
  PlayerState,
  StageState,
} from "./types";

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

async function findGame(db: Reader, ref: string): Promise<GameRow | undefined> {
  const bySlug = await db.select().from(games).where(eq(games.slug, ref)).limit(1);
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
          .orderBy(asc(actors.createdAt), asc(actors.name));
  const actorIds = actorRows.map((actor) => actor.id);

  const itemRows =
    actorIds.length === 0
      ? []
      : await db
          .select()
          .from(items)
          .where(inArray(items.actorId, actorIds))
          .orderBy(asc(items.createdAt), asc(items.name));

  const messageRows = await db
    .select()
    .from(gameMessages)
    .where(eq(gameMessages.gameId, game.id))
    .orderBy(asc(gameMessages.sequence));

  const itemsByActor = new Map<string, ItemState[]>();
  for (const item of itemRows) {
    const list = itemsByActor.get(item.actorId) ?? [];
    list.push({
      id: item.id,
      name: item.name,
      description: item.description,
      kind: item.kind,
    });
    itemsByActor.set(item.actorId, list);
  }

  const actorsByStage = new Map<string, ActorState[]>();
  for (const actor of actorRows) {
    const list = actorsByStage.get(actor.stageId) ?? [];
    list.push({
      id: actor.id,
      name: actor.name,
      profile: actor.profile,
      appearance: actor.appearance,
      hp: actor.hp,
      maxHp: actor.maxHp,
      attack: actor.attack,
      defense: actor.defense,
      speed: actor.speed,
      items: itemsByActor.get(actor.id) ?? [],
    });
    actorsByStage.set(actor.stageId, list);
  }

  const stageState: StageState[] = stageRows.map((stage) => ({
    id: stage.id,
    name: stage.name,
    profile: stage.profile,
    environment: stage.environment,
    narrative: stage.narrative,
    ordinal: stage.ordinal,
    actors: actorsByStage.get(stage.id) ?? [],
  }));

  const connections: ConnectionState[] = connectionRows.map((connection) => ({
    id: connection.id,
    fromStageId: connection.fromStageId,
    toStageId: connection.toStageId,
  }));

  const player: PlayerState = {
    id: playerRow.id,
    userId: playerRow.userId,
    username: playerRow.username,
    displayName: playerRow.displayName,
    role: playerRow.role,
  };

  const messages: MessageState[] = messageRows.map((message) => ({
    id: message.id,
    sequence: message.sequence,
    kind: message.kind,
    speakerActorId: message.speakerActorId,
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
      contentVersion: game.contentVersion,
      version: game.version,
      createdAt: iso(game.createdAt),
      updatedAt: iso(game.updatedAt),
    },
    player,
    world: {
      id: worldRow.id,
      name: worldRow.name,
      campaignSetting: worldRow.campaignSetting,
      systemRules: worldRow.systemRules,
      stages: stageState,
      connections,
    },
    messages,
  };
}

export async function createGame(db: Database, input: CreateGameInput): Promise<GameState> {
  const gameId = randomUUID();
  const gameName = input.name?.trim() || input.seed.worldName;
  const requestedSlug = input.slug?.trim();
  const baseSlug = slugify(requestedSlug ?? gameName);
  if (requestedSlug !== undefined && baseSlug.length === 0) {
    throw new GameError("invalid_action", `slug 不能为空或只包含非 ASCII 字符: ${requestedSlug}`);
  }
  const slug = requestedSlug ? baseSlug : `${baseSlug || "game"}-${gameId.slice(0, 8)}`;

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
      contentVersion: input.seed.contentVersion,
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
      gameId,
      name: input.seed.worldName,
      campaignSetting: input.seed.campaignSetting,
      systemRules: input.seed.systemRules,
    });

    const stageIds = new Map<string, string>();
    for (const [ordinal, seed] of input.seed.stages.entries()) {
      if (stageIds.has(seed.key)) {
        throw new GameError("invalid_state", `重复的 stage key: ${seed.key}`);
      }
      const stageId = randomUUID();
      stageIds.set(seed.key, stageId);
      await tx.insert(stages).values({
        id: stageId,
        worldId,
        name: seed.name,
        profile: seed.profile,
        environment: seed.environment,
        narrative: seed.narrative,
        ordinal,
      });
    }

    for (const connection of input.seed.connections) {
      const fromStageId = stageIds.get(connection.from);
      const toStageId = stageIds.get(connection.to);
      if (!fromStageId || !toStageId) {
        throw new GameError(
          "invalid_state",
          `连接引用了不存在的 stage: ${connection.from} -> ${connection.to}`,
        );
      }
      await tx.insert(stageConnections).values({
        id: randomUUID(),
        worldId,
        fromStageId,
        toStageId,
      });
    }

    const actorStageId = stageIds.get(input.seed.actor.stageKey);
    if (!actorStageId) {
      throw new GameError(
        "invalid_state",
        `actor 引用了不存在的 stage: ${input.seed.actor.stageKey}`,
      );
    }

    const actorId = randomUUID();
    await tx.insert(actors).values({
      id: actorId,
      stageId: actorStageId,
      controllerPlayerId: playerId,
      name: input.seed.actor.name,
      profile: input.seed.actor.profile,
      appearance: input.seed.actor.appearance,
      hp: input.seed.actor.hp,
      maxHp: input.seed.actor.maxHp,
      attack: input.seed.actor.attack,
      defense: input.seed.actor.defense,
      speed: input.seed.actor.speed,
    });

    await tx.insert(items).values({
      id: randomUUID(),
      actorId,
      name: input.seed.item.name,
      description: input.seed.item.description,
      kind: input.seed.item.kind,
    });

    if (input.seed.initialNarration) {
      await tx.insert(gameMessages).values({
        id: randomUUID(),
        gameId,
        sequence: 1,
        kind: "narration",
        speakerActorId: actorId,
        content: input.seed.initialNarration,
      });
    }
  });

  return getGameState(db, gameId);
}

export async function runAction(
  db: Database,
  ref: string,
  action: GameActionInput,
): Promise<GameState> {
  if (action.type !== "move") {
    throw new GameError("invalid_action", `不支持的动作: ${String(action.type)}`);
  }
  if (action.to.trim().length === 0) {
    throw new GameError("invalid_action", "move 需要目标 stage");
  }

  const gameId = await db.transaction(async (tx) => {
    const game = await findGame(tx, ref);
    if (!game) {
      throw new GameError("not_found", `游戏不存在: ${ref}`);
    }

    await tx.select().from(games).where(eq(games.id, game.id)).for("update");

    const [player] = await tx
      .select()
      .from(gamePlayers)
      .where(eq(gamePlayers.gameId, game.id))
      .limit(1);
    if (!player) {
      throw new GameError("invalid_state", `游戏缺少 player: ${game.id}`);
    }

    const [world] = await tx.select().from(worlds).where(eq(worlds.gameId, game.id)).limit(1);
    if (!world) {
      throw new GameError("invalid_state", `游戏缺少 world: ${game.id}`);
    }

    const [actorRow] = await tx
      .select({ actor: actors, stage: stages })
      .from(actors)
      .innerJoin(stages, eq(actors.stageId, stages.id))
      .where(and(eq(stages.worldId, world.id), eq(actors.controllerPlayerId, player.id)))
      .limit(1);
    if (!actorRow) {
      throw new GameError("invalid_state", `游戏缺少玩家控制的 actor: ${game.id}`);
    }

    const [targetByName] = await tx
      .select()
      .from(stages)
      .where(and(eq(stages.worldId, world.id), eq(stages.name, action.to)))
      .limit(1);
    let target = targetByName;
    if (!target && UUID_PATTERN.test(action.to)) {
      const [targetById] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.worldId, world.id), eq(stages.id, action.to)))
        .limit(1);
      target = targetById;
    }
    if (!target) {
      throw new GameError("invalid_action", `目标 stage 不存在: ${action.to}`);
    }
    if (target.id === actorRow.stage.id) {
      throw new GameError("invalid_action", `角色已经在 ${target.name}`);
    }

    const [connection] = await tx
      .select()
      .from(stageConnections)
      .where(
        and(
          eq(stageConnections.worldId, world.id),
          eq(stageConnections.fromStageId, actorRow.stage.id),
          eq(stageConnections.toStageId, target.id),
        ),
      )
      .limit(1);
    if (!connection) {
      throw new GameError(
        "invalid_action",
        `没有从 ${actorRow.stage.name} 到 ${target.name} 的连接`,
      );
    }

    const now = new Date();
    await tx
      .update(actors)
      .set({ stageId: target.id, updatedAt: now })
      .where(eq(actors.id, actorRow.actor.id));

    await tx
      .update(games)
      .set({ version: sql<number>`${games.version} + 1`, updatedAt: now })
      .where(eq(games.id, game.id));

    const [maxRow] = await tx
      .select({ value: sql<number>`coalesce(max(${gameMessages.sequence}), 0)` })
      .from(gameMessages)
      .where(eq(gameMessages.gameId, game.id));
    const next = Number(maxRow?.value ?? 0) + 1;

    await tx.insert(gameMessages).values([
      {
        id: randomUUID(),
        gameId: game.id,
        sequence: next,
        kind: "player",
        speakerActorId: actorRow.actor.id,
        content: `我走向${target.name}。`,
      },
      {
        id: randomUUID(),
        gameId: game.id,
        sequence: next + 1,
        kind: "narration",
        speakerActorId: null,
        content: `你从${actorRow.stage.name}动身，穿过两处场景之间的路，抵达${target.name}。${target.narrative}`,
      },
    ]);

    return game.id;
  });

  return getGameState(db, gameId);
}
