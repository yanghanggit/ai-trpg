import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { Stats } from "../game/attributes";
import type {
  ActionKind,
  BaseBody,
  EquipmentSlots,
  ItemEffect,
  ItemKind,
  PassageState,
  StageActionKind,
  WorldActionKind,
} from "../game/types";
import { EMBEDDING_DIMENSIONS } from "../rag/constants";
import type { RagMetadata } from "../rag/types";

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
    /** 剧本稳定标识；知识库 collection 用它寻址，不随展示名变化。 */
    contentKey: text("content_key").notNull(),
    campaignSetting: text("campaign_setting").notNull(),
    systemRules: text("system_rules").notNull(),
    actions: jsonb("actions").$type<WorldActionKind[]>().notNull().default([]),
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
    /** 内容层的稳定 key；旧数据可能为空。 */
    key: text("key"),
    name: text("name").notNull(),
    profile: text("profile").notNull(),
    environment: text("environment").notNull(),
    actions: jsonb("actions").$type<StageActionKind[]>().notNull().default([]),
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
    /** 通行状态；sealed 表示剧情上相连但当前不可通过。 */
    passage: text("passage").$type<PassageState>().notNull().default("open"),
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
  name: text("name").notNull(),
  profile: text("profile").notNull(),
  appearance: text("appearance").notNull(),
  baseBody: jsonb("base_body").$type<BaseBody>().notNull(),
  stats: jsonb("stats").$type<Stats>().notNull(),
  /** 当前生命；与 stats 分开存，扣血只写这一列。`hp === 0` 即死亡，没有单独的死亡状态。 */
  hp: integer("hp").notNull(),
  /** 死亡阶段已处理的时间；null 表示 `hp === 0` 但还没跑过死亡阶段（外观更新、未来的复活判定）。 */
  deathSettledAt: timestamp("death_settled_at", { withTimezone: true }),
  /** 默认玩家角色；该角色死亡时整局结束。 */
  isDefaultPlayer: boolean("is_default_player").notNull().default(false),
  equipment: jsonb("equipment").$type<EquipmentSlots>().notNull().default({}),
  actions: jsonb("actions").$type<ActionKind[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `id` 是物品的稳定身份（uuid）；`name` 是动作与装备槽使用的可读句柄，
 * 因此在同一个 actor 内必须唯一——这是 `(actor_id, name)` 唯一索引的含义。
 */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    key: text("key"),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").$type<ItemKind>().notNull(),
    count: integer("count").notNull().default(1),
    stats: jsonb("stats").$type<Stats>().notNull(),
    effect: jsonb("effect").$type<ItemEffect>().notNull(),
    affixes: jsonb("affixes").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("items_actor_name_unique").on(table.actorId, table.name)],
);

/** 与 `items` 同构；名字在同一个场景内唯一，拾取时才能按名字定位。 */
export const stageItems = pgTable(
  "stage_items",
  {
    id: uuid("id").primaryKey(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    key: text("key"),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").$type<ItemKind>().notNull(),
    count: integer("count").notNull().default(1),
    stats: jsonb("stats").$type<Stats>().notNull(),
    effect: jsonb("effect").$type<ItemEffect>().notNull(),
    affixes: jsonb("affixes").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("stage_items_stage_name_unique").on(table.stageId, table.name)],
);

export const gameMessages = pgTable(
  "game_messages",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    stageId: uuid("stage_id").references(() => stages.id, { onDelete: "set null" }),
    sourceActorId: uuid("source_actor_id").references(() => actors.id, {
      onDelete: "set null",
    }),
    targetActorId: uuid("target_actor_id").references(() => actors.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility").notNull().default("stage"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("game_messages_game_sequence_unique").on(table.gameId, table.sequence)],
);

export const vectorDocuments = pgTable(
  "vector_documents",
  {
    id: uuid("id").primaryKey(),
    collection: text("collection").notNull(),
    source: text("source"),
    docType: text("doc_type"),
    title: text("title"),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata").$type<RagMetadata>().notNull().default({}),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vector_documents_collection_hash_unique").on(table.collection, table.contentHash),
    index("vector_documents_collection_idx").on(table.collection),
    index("vector_documents_collection_model_idx").on(table.collection, table.embeddingModel),
    index("vector_documents_embedding_hnsw").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export const actorControls = pgTable("actor_controls", {
  actorId: uuid("actor_id")
    .primaryKey()
    .references(() => actors.id, { onDelete: "cascade" }),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  playerId: uuid("player_id")
    .notNull()
    .references(() => gamePlayers.id, { onDelete: "cascade" }),
  controllerType: text("controller_type").notNull().default("player"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    ownerType: text("owner_type").notNull().default("actor"),
    ownerId: uuid("owner_id").notNull(),
    name: text("name").notNull(),
    contextUsageRatio: real("context_usage_ratio").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_memories_game_owner_unique").on(
      table.gameId,
      table.ownerType,
      table.ownerId,
    ),
  ],
);

export const agentMemoryMessages = pgTable(
  "agent_memory_messages",
  {
    id: uuid("id").primaryKey(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => agentMemories.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls").$type<JsonValue>(),
    toolCallId: text("tool_call_id"),
    metadata: jsonb("metadata").$type<JsonValue>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_memory_messages_memory_sequence_unique").on(table.memoryId, table.sequence),
  ],
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
  stageItems,
  gameMessages,
  vectorDocuments,
  actorControls,
  agentMemories,
  agentMemoryMessages,
};
