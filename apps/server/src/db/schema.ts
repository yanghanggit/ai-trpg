import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * 基础设施元数据。用于开发期 seed / schema 探针，
 * 不承载游戏领域状态。
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<JsonValue>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    contentVersion: text("content_version").notNull(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("games_owner_slug_unique").on(table.ownerId, table.slug)],
);

export const gamePlayers = pgTable(
  "game_players",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("player"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("game_players_game_unique").on(table.gameId)],
);

export const worlds = pgTable(
  "worlds",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    campaignSetting: text("campaign_setting").notNull(),
    systemRules: text("system_rules").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("worlds_game_unique").on(table.gameId)],
);

export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    profile: text("profile").notNull(),
    environment: text("environment").notNull(),
    narrative: text("narrative").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("stages_world_name_unique").on(table.worldId, table.name)],
);

export const stageConnections = pgTable(
  "stage_connections",
  {
    id: uuid("id").primaryKey(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    fromStageId: uuid("from_stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    toStageId: uuid("to_stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stage_connections_world_edge_unique").on(
      table.worldId,
      table.fromStageId,
      table.toStageId,
    ),
  ],
);

export const actors = pgTable("actors", {
  id: uuid("id").primaryKey(),
  stageId: uuid("stage_id")
    .notNull()
    .references(() => stages.id, { onDelete: "cascade" }),
  controllerPlayerId: uuid("controller_player_id").references(() => gamePlayers.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  profile: text("profile").notNull(),
  appearance: text("appearance").notNull(),
  hp: integer("hp").notNull(),
  maxHp: integer("max_hp").notNull(),
  attack: integer("attack").notNull(),
  defense: integer("defense").notNull(),
  speed: integer("speed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const items = pgTable("items", {
  id: uuid("id").primaryKey(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => actors.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gameMessages = pgTable(
  "game_messages",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    speakerActorId: uuid("speaker_actor_id").references(() => actors.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("game_messages_game_sequence_unique").on(table.gameId, table.sequence)],
);

export const schema = {
  appMeta,
  users,
  games,
  gamePlayers,
  worlds,
  stages,
  stageConnections,
  actors,
  items,
  gameMessages,
};

export type AppSchema = typeof schema;
