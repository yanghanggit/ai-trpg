import { sql } from "drizzle-orm";
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
  Affix,
  BaseBody,
  DialogueActionKind,
  DialogueCategory,
  EquipmentSlots,
  ItemEffect,
  ItemKind,
  PassageState,
  StageActionKind,
  WorldActionKind,
} from "../game/types";
import type { JobStatus } from "../jobs/types";
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
    /** 结束时的结局标签，由 world 自己命名；active 局为空。 */
    outcome: text("outcome"),
    contentVersion: text("content_version").notNull(),
    version: integer("version").notNull().default(0),
    /** 本局实体序号的当前值；world / stage / actor / item 共用。 */
    entitySeq: integer("entity_seq").notNull().default(0),
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
    /** 本局内唯一的排序号；身份仍用 id。 */
    seq: integer("seq").notNull().default(0),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** 剧本稳定标识；知识库 collection 用它寻址，不随展示名变化。 */
    contentKey: text("content_key").notNull(),
    profile: text("profile").notNull(),
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
    /** 本局内唯一的排序号；身份仍用 id。 */
    seq: integer("seq").notNull().default(0),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    /** 内容层的稳定 key；旧数据可能为空。 */
    key: text("key"),
    name: text("name").notNull(),
    profile: text("profile").notNull(),
    environment: text("environment").notNull(),
    actions: jsonb("actions").$type<StageActionKind[]>().notNull().default([]),
    /** 禁止 teleport 进出；普通 move 不受影响。 */
    teleportBlocked: boolean("teleport_blocked").notNull().default(false),
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
  /** 本局内唯一的排序号；身份仍用 id。 */
  seq: integer("seq").notNull().default(0),
  stageId: uuid("stage_id")
    .notNull()
    .references(() => stages.id, { onDelete: "cascade" }),
  /** 内容层稳定 key；连接、知识等需要引用角色时用它，不再用展示名。 */
  key: text("key").notNull(),
  name: text("name").notNull(),
  profile: text("profile").notNull(),
  baseBody: jsonb("base_body").$type<BaseBody>().notNull(),
  stats: jsonb("stats").$type<Stats>().notNull(),
  /** 当前生命；与 stats 分开存，扣血只写这一列。`hp === 0` 即死亡，没有单独的死亡状态。 */
  hp: integer("hp").notNull(),
  /** 死亡阶段已处理的时间；null 表示 `hp === 0` 但还没收尾。 */
  deathSettledAt: timestamp("death_settled_at", { withTimezone: true }),
  /** 默认玩家角色；该角色死亡时整局结束。 */
  isDefaultPlayer: boolean("is_default_player").notNull().default(false),
  equipment: jsonb("equipment").$type<EquipmentSlots>().notNull().default({}),
  actions: jsonb("actions").$type<ActionKind[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** actor 去过哪些场景；用于 teleport 目标与地图，不参与普通 move 权限。 */
export const stageVisits = pgTable(
  "stage_visits",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    firstVisitedAt: timestamp("first_visited_at", { withTimezone: true }).notNull().defaultNow(),
    lastVisitedAt: timestamp("last_visited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stage_visits_actor_stage_unique").on(table.actorId, table.stageId),
    index("stage_visits_game_actor_idx").on(table.gameId, table.actorId),
  ],
);

/**
 * 一个 actor 可被看见的「形象」（presentation）。
 *
 * `appearance` 属于形象而不是躯壳：换装只改当前形象，身份不变；伪装 / 变身会开一条
 * 新的形象并把旧的 `ended_at` 封上，所以认识旧形象的人看到新形象时认不出他。
 * 同一 actor 同时最多一条 `ended_at is null` 的形象。
 */
export const actorPresentations = pgTable(
  "actor_presentations",
  {
    id: uuid("id").primaryKey(),
    /** 本局内唯一的排序号；观察者句柄由它派生。 */
    seq: integer("seq").notNull().default(0),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    /** 稳定的识别特征（断眉、缺耳、跛足）；换装不会改写它。 */
    anchor: text("anchor").notNull(),
    /** 此刻别人看到的样子。 */
    appearance: text("appearance").notNull(),
    /** 是否为该 actor 的本相；伪装 / 变身产生的形象为 false。 */
    isDefault: boolean("is_default").notNull().default(true),
    /** 形象退场时间；null 表示当前正在使用。 */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("actor_presentations_actor_idx").on(table.actorId),
    uniqueIndex("actor_presentations_current_unique")
      .on(table.actorId)
      .where(sql`${table.endedAt} is null`),
  ],
);

/**
 * 名字信念：观察者相信某个形象叫什么。
 *
 * 键是「观察者 × 形象」而不是「观察者 × actor」：伪装 / 变身会换形象，认识旧形象的人
 * 不会自动认出新形象。`name` 是信念而不是真名（可以是假名、误认），引擎不校验。
 */
export const nameKnowledge = pgTable(
  "name_knowledge",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    observerActorId: uuid("observer_actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    presentationId: uuid("presentation_id")
      .notNull()
      .references(() => actorPresentations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** `content`：开局既知；`self`：角色自己在回合里记下的。 */
    source: text("source").notNull().default("self"),
    /** 在哪里得知的；只用于审计。 */
    learnedStageId: uuid("learned_stage_id").references(() => stages.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("name_knowledge_observer_presentation_unique").on(
      table.observerActorId,
      table.presentationId,
    ),
    index("name_knowledge_game_observer_idx").on(table.gameId, table.observerActorId),
  ],
);

/** `id` 是稳定身份，`name` 是动作与槽位使用的可读句柄，因此同一 actor 内唯一。 */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey(),
    /** 本局内唯一的排序号；身份仍用 id。 */
    seq: integer("seq").notNull().default(0),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    key: text("key"),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").$type<ItemKind>().notNull(),
    /** 材料来源（哪个角色留下的）；只有 material 会写，其它大类保持 null。 */
    source: text("source"),
    count: integer("count").notNull().default(1),
    stats: jsonb("stats").$type<Stats>().notNull(),
    effect: jsonb("effect").$type<ItemEffect>().notNull(),
    affixes: jsonb("affixes").$type<Affix[]>().notNull().default([]),
    /** 物品提供的动作；只有穿戴中才会生效，目前只有武器会声明。 */
    actions: jsonb("actions").$type<ActionKind[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("items_actor_name_unique").on(table.actorId, table.name)],
);

/** 与 `items` 同构；名字在同一个场景内唯一，拾取时才能按名字定位。 */
export const stageItems = pgTable(
  "stage_items",
  {
    id: uuid("id").primaryKey(),
    /** 本局内唯一的排序号；身份仍用 id。 */
    seq: integer("seq").notNull().default(0),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    key: text("key"),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").$type<ItemKind>().notNull(),
    /** 材料来源（哪个角色留下的）；只有 material 会写，其它大类保持 null。 */
    source: text("source"),
    count: integer("count").notNull().default(1),
    stats: jsonb("stats").$type<Stats>().notNull(),
    effect: jsonb("effect").$type<ItemEffect>().notNull(),
    affixes: jsonb("affixes").$type<Affix[]>().notNull().default([]),
    /** 物品提供的动作；只有穿戴中才会生效，目前只有武器会声明。 */
    actions: jsonb("actions").$type<ActionKind[]>().notNull().default([]),
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

/**
 * 玩家对话黑名单/审计记录。
 *
 * 只记录被拒绝的玩家对话（内容违规或审核不可用），允许的对话不落库。
 * `content` 保留原文，供人工复核；`failure_kind` 区分内容违规与审核失败。
 */
export const dialogueBlocks = pgTable(
  "dialogue_blocks",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => gamePlayers.id, { onDelete: "cascade" }),
    actionKind: text("action_kind").$type<DialogueActionKind>().notNull(),
    targetActorId: uuid("target_actor_id").references(() => actors.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    categories: jsonb("categories").$type<DialogueCategory[]>().notNull().default([]),
    reason: text("reason").notNull(),
    failureKind: text("failure_kind"),
    model: text("model"),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dialogue_blocks_game_created_idx").on(table.gameId, table.createdAt),
    index("dialogue_blocks_game_hash_idx").on(table.gameId, table.contentHash),
  ],
);

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

/**
 * 持久作业队列。一行作业同时承载 payload、状态、最后一次错误与结果，
 * 不再像旧系统那样额外维护 task_errors 表。
 *
 * `serialization_key` 的 partial unique index 保证同一 queue + key 最多一个
 * pending / running 作业；终态行不占用键，因此可以继续入队。
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    queue: text("queue").notNull().default("default"),
    payload: jsonb("payload").$type<JsonValue>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    serializationKey: text("serialization_key"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(1),
    error: text("error"),
    result: jsonb("result").$type<JsonValue>(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_claim_idx").on(table.queue, table.status, table.runAt, table.createdAt),
    index("jobs_status_created_idx").on(table.status, table.createdAt),
    index("jobs_kind_idx").on(table.kind),
    uniqueIndex("jobs_active_serialization_unique")
      .on(table.queue, table.serializationKey)
      .where(
        sql`${table.serializationKey} is not null and ${table.status} in ('pending', 'running')`,
      ),
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
  stageVisits,
  actorPresentations,
  nameKnowledge,
  items,
  stageItems,
  gameMessages,
  vectorDocuments,
  actorControls,
  dialogueBlocks,
  agentMemories,
  agentMemoryMessages,
  jobs,
};
