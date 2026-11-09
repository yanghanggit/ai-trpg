import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import type { DialogueActionKind, DialogueCategory } from "../game/persistence/dialogue-blocks";
import type {
  AffixTriggers,
  AppearanceInput,
  CarriedActionKind,
  EquipmentSlots,
  InnateActionKind,
  ItemKind,
  PassageState,
  StageActionKind,
  StageAnchorState,
  WorldActionKind,
  WorldFunction,
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
    /** 对外引用名：URL / CLI 里代替 id 的短名，仅在同一 owner 内唯一。 */
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
    globalRules: text("global_rules").notNull(),
    /** 开局定档的世界职能宪法：职能 → 完整 system prompt；与 global_rules 一样是快照。 */
    functionPrompts: jsonb("function_prompts").$type<Record<WorldFunction, string>>().notNull(),
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
    /** 本局内唯一的实体序号；未访问场景的 #seq 句柄由它派生。 */
    seq: integer("seq").notNull().default(0),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    /** 内容层的稳定 key；旧数据可能为空。 */
    key: text("key"),
    name: text("name").notNull(),
    profile: text("profile").notNull(),
    environment: text("environment").notNull(),
    /** 只存身份与文本；物品在 `stage_items`，靠 `anchor_key` 挂回。 */
    anchors: jsonb("anchors")
      .$type<Pick<StageAnchorState, "key" | "label" | "description">[]>()
      .notNull()
      .default([]),
    actions: jsonb("actions").$type<StageActionKind[]>().notNull().default([]),
    /** 禁止 teleport 进出；普通 move 不受影响。 */
    teleportBlocked: boolean("teleport_blocked").notNull().default(false),
    ordinal: integer("ordinal").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stages_world_name_unique").on(table.worldId, table.name),
    uniqueIndex("stages_world_seq_unique").on(table.worldId, table.seq),
  ],
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
  stats: jsonb("stats").$type<Stats>().notNull(),
  /** 当前生命；与 stats 分开存，扣血只写这一列。`hp === 0` 即死亡，没有单独的死亡状态。 */
  hp: integer("hp").notNull(),
  /** 死亡阶段已处理的时间；null 表示 `hp === 0` 但还没收尾。 */
  deathSettledAt: timestamp("death_settled_at", { withTimezone: true }),
  /** 默认玩家角色；该角色死亡时整局结束。 */
  isDefaultPlayer: boolean("is_default_player").notNull().default(false),
  equipment: jsonb("equipment").$type<EquipmentSlots>().notNull().default({}),
  /** 角色固有动作；携带者（武器）授予的动作不入库。 */
  actions: jsonb("actions").$type<InnateActionKind[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** actor 去过哪些场景；用于地图、已访问候选与查看，不参与普通 move 权限。 */
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
 * 一个 actor 可被看见的「签名」（signature）。
 *
 * 签名是观察者识别的单位：`form` 是稳定的形态描述（`种族:描述`），`appearance` 是此刻
 * 合成的样子。换装、受伤、死亡只改 `appearance`；伪装 / 变身会开一条新签名并把旧的
 * `ended_at` 封上，所以认识旧签名的人看到新签名时认不出他。同一 actor 同时最多一条
 * `ended_at is null` 的签名。
 */
export const actorSignatures = pgTable(
  "actor_signatures",
  {
    id: uuid("id").primaryKey(),
    /** 本局内唯一的排序号；观察者句柄由它派生。 */
    seq: integer("seq").notNull().default(0),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    /** 稳定的形态描述，必须写成 `种族:描述`；换装不会改写它。 */
    form: text("form").notNull(),
    /** 签名退场时间；null 表示当前正在使用。 */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("actor_signatures_actor_idx").on(table.actorId),
    uniqueIndex("actor_signatures_current_unique")
      .on(table.actorId)
      .where(sql`${table.endedAt} is null`),
    check("actor_signatures_form_format", sql`${table.form} ~ '^[^:[\\]\\r\\n]+:\\S[^\\r\\n]*$'`),
  ],
);

/**
 * 外观渲染记录：每次成功生成外观都是一行不可变快照。
 *
 * `text` 是最终渲染值；`input` 保存生成那一刻的完整输入（prompt / 穿戴 / 来源）。
 * 每个签名同时只有一条 `superseded_at is null` 的当前记录；历史行不覆盖、不删除。
 */
export const appearances = pgTable(
  "appearances",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    signatureId: uuid("signature_id")
      .notNull()
      .references(() => actorSignatures.id, { onDelete: "cascade" }),
    /** 最终渲染值；原 appearance 字符串。 */
    text: text("text").notNull(),
    /** 来源：seed（预编译）/ runtime（运行时 LLM）。 */
    source: text("source").notNull(),
    /** 生成那一刻的输入快照；结构见 `AppearanceInput`。 */
    input: jsonb("input").$type<AppearanceInput>().notNull(),
    /** 被后续渲染取代的时间；null 表示当前。 */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("appearances_current_unique")
      .on(table.signatureId)
      .where(sql`${table.supersededAt} is null`),
    index("appearances_game_created_idx").on(table.gameId, table.createdAt),
    index("appearances_signature_created_idx").on(table.signatureId, table.createdAt),
  ],
);

/**
 * actor 对签名的当前称呼：观察者 × 签名 → 名字。
 *
 * 名字是观察者的认知，不要求等于 `actors.name`；同一个签名再次写入时直接覆盖当前名字。
 * 键是签名而不是 actor：伪装 / 变身会换签名，旧名字不会自动跟到新签名。
 */
export const actorSignatureNames = pgTable(
  "actor_signature_names",
  {
    id: uuid("id").primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    observerActorId: uuid("observer_actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    signatureId: uuid("signature_id")
      .notNull()
      .references(() => actorSignatures.id, { onDelete: "cascade" }),
    /** 观察者当前对这个签名的称呼；可以是真名、称号、误认的名字。 */
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
    uniqueIndex("actor_signature_names_observer_signature_unique").on(
      table.observerActorId,
      table.signatureId,
    ),
    index("actor_signature_names_game_observer_idx").on(table.gameId, table.observerActorId),
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
    /** `cleave` 一次最多命中的目标数；只有武器会大于 1，其余大类恒为 1。 */
    maxTargets: integer("max_targets").notNull().default(1),
    affixes: jsonb("affixes").$type<AffixTriggers>().notNull().default({}),
    /** 携带者动作；只有穿戴中才会生效，目前只有武器会声明。 */
    actions: jsonb("actions").$type<CarriedActionKind[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("items_actor_name_unique").on(table.actorId, table.name)],
);

/** 与 `items` 同构；名字在同一个锚点内唯一，拾取时按 (锚点, 名字) 定位。 */
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
    /** 承载这件物品的锚点：物品不能脱离锚点，key 由内容层声明。 */
    anchorKey: text("anchor_key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").$type<ItemKind>().notNull(),
    /** 材料来源（哪个角色留下的）；只有 material 会写，其它大类保持 null。 */
    source: text("source"),
    count: integer("count").notNull().default(1),
    stats: jsonb("stats").$type<Stats>().notNull(),
    /** 跟着这件东西走的挥击上限：从锚点搬进背包、被偷走都不改。 */
    maxTargets: integer("max_targets").notNull().default(1),
    affixes: jsonb("affixes").$type<AffixTriggers>().notNull().default({}),
    /** 携带者动作；只有穿戴中才会生效，目前只有武器会声明。 */
    actions: jsonb("actions").$type<CarriedActionKind[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 物品地址是 (场景, 锚点, 名字)：同一场景的不同锚点可以各放一件同名物品。
    uniqueIndex("stage_items_stage_anchor_name_unique").on(
      table.stageId,
      table.anchorKey,
      table.name,
    ),
  ],
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
  actorSignatures,
  actorSignatureNames,
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
