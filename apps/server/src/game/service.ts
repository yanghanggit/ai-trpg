import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
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
import { buildActorSystemPrompt, createActorMemory } from "./memory";
import type {
  ActorState,
  ConnectionState,
  CreateGameInput,
  GameState,
  ItemState,
  MessageState,
  MessageVisibility,
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
      death: actor.death,
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
    stageId: message.stageId,
    speakerActorId: message.speakerActorId,
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

/** 创建一局游戏及初始 world、stage、actor、item 与 memory。 */
export async function createGame(db: Database, input: CreateGameInput): Promise<GameState> {
  const gameId = randomUUID();
  const gameName = input.name?.trim() || input.world.worldName;
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
      gameId,
      name: input.world.worldName,
      campaignSetting: input.world.campaignSetting,
      systemRules: input.world.systemRules,
    });

    const stageIds = new Map<string, string>();
    for (const [ordinal, stage] of input.world.stages.entries()) {
      if (stageIds.has(stage.key)) {
        throw new GameError("invalid_state", `重复的 stage key: ${stage.key}`);
      }
      const stageId = randomUUID();
      stageIds.set(stage.key, stageId);
      await tx.insert(stages).values({
        id: stageId,
        worldId,
        name: stage.name,
        profile: stage.profile,
        environment: stage.environment,
        narrative: stage.narrative,
        ordinal,
      });
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
      await tx.insert(stageConnections).values({
        id: randomUUID(),
        worldId,
        fromStageId,
        toStageId,
      });
    }

    for (const actor of input.world.actors) {
      const actorStageId = stageIds.get(actor.stageKey);
      if (!actorStageId) {
        throw new GameError("invalid_state", `actor 引用了不存在的 stage: ${actor.stageKey}`);
      }

      const actorId = randomUUID();
      await tx.insert(actors).values({
        id: actorId,
        stageId: actorStageId,
        name: actor.name,
        profile: actor.profile,
        appearance: actor.appearance,
        hp: actor.hp,
        maxHp: actor.maxHp,
        attack: actor.attack,
        defense: actor.defense,
        speed: actor.speed,
        death: actor.death ?? false,
      });

      for (const item of actor.items) {
        await tx.insert(items).values({
          id: randomUUID(),
          actorId,
          name: item.name,
          description: item.description,
          kind: item.kind,
        });
      }

      await createActorMemory(
        tx,
        gameId,
        { id: actorId, name: actor.name, profile: actor.profile, appearance: actor.appearance },
        buildActorSystemPrompt(
          {
            id: worldId,
            name: input.world.worldName,
            campaignSetting: input.world.campaignSetting,
            systemRules: input.world.systemRules,
          },
          actor,
        ),
      );
    }

    if (input.world.initialNarration) {
      await tx.insert(gameMessages).values({
        id: randomUUID(),
        gameId,
        sequence: 1,
        kind: "narration",
        stageId: input.world.stages[0] ? (stageIds.get(input.world.stages[0].key) ?? null) : null,
        speakerActorId: null,
        targetActorId: null,
        visibility: "stage",
        content: input.world.initialNarration,
      });
    }
  });

  return getGameState(db, gameId);
}
