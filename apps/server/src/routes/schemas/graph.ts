/**
 * 图谱的线上契约：`GameGraphData` 的逐个字段。
 *
 * 形状的源在 `game-ops/graph`，这里只负责序列化与文档；`satisfies` 让编排层加字段、
 * 改可空性时这里编译不过，而不是等客户端拿到一个它不认识的 JSON。
 *
 * 叶子实体（道具、装备、属性、外观、状态效果）是原样透传的行，不在这里复制引擎的联合类型——
 * 与建局数据同一条口径：翻译一层就少一层可信。
 */

import { z } from "zod";
import type {
  GameGraphActor,
  GameGraphAnchor,
  GameGraphConnection,
  GameGraphData,
  GameGraphGame,
  GameGraphStage,
  GameGraphWorld,
} from "../../game-ops/graph";
import { actionOrderRoundSchema, actionOrderSchema } from "./action-order";

const entitySchema = z.record(z.string(), z.unknown());

const gameGraphGameSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    status: z.string(),
    outcome: z.string().nullable(),
    clock: z.number(),
    version: z.number(),
    contentVersion: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: "GameGraphGame" }) satisfies z.ZodType<GameGraphGame>;

const gameGraphWorldSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    contentKey: z.string(),
  })
  .meta({ id: "GameGraphWorld" }) satisfies z.ZodType<GameGraphWorld>;

const gameGraphAnchorSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    description: z.string().optional(),
    items: z.array(entitySchema),
  })
  .meta({ id: "GameGraphAnchor" }) satisfies z.ZodType<GameGraphAnchor>;

const gameGraphStageSchema = z
  .object({
    id: z.string(),
    seq: z.number(),
    key: z.string(),
    name: z.string(),
    ordinal: z.number(),
    environment: z.string(),
    teleportBlocked: z.boolean(),
    actions: z.array(z.string()),
    anchors: z.array(gameGraphAnchorSchema),
  })
  .meta({ id: "GameGraphStage" }) satisfies z.ZodType<GameGraphStage>;

const gameGraphConnectionSchema = z
  .object({
    id: z.string(),
    fromStageId: z.string(),
    toStageId: z.string(),
    passage: z.enum(["open", "sealed"]),
  })
  .meta({ id: "GameGraphConnection" }) satisfies z.ZodType<GameGraphConnection>;

const gameGraphActorSchema = z
  .object({
    id: z.string(),
    seq: z.number(),
    key: z.string(),
    name: z.string(),
    stageId: z.string(),
    hp: z.number(),
    maxHp: z.number(),
    stats: entitySchema,
    concealed: z.boolean(),
    isDefaultPlayer: z.boolean(),
    appearance: entitySchema,
    signature: z.object({ id: z.string(), seq: z.number(), form: z.string() }),
    equipment: entitySchema,
    items: z.array(entitySchema),
    statusEffects: z.array(entitySchema),
    knowledgeAccess: z.array(z.string()),
    actions: z.array(z.string()),
  })
  .meta({ id: "GameGraphActor" }) satisfies z.ZodType<GameGraphActor>;

export const gameGraphSchema = z
  .object({
    game: gameGraphGameSchema,
    world: gameGraphWorldSchema,
    stages: z.array(gameGraphStageSchema),
    connections: z.array(gameGraphConnectionSchema),
    actors: z.array(gameGraphActorSchema),
    order: actionOrderSchema.nullable(),
    round: actionOrderRoundSchema.nullable(),
  })
  .meta({ id: "GameGraph" }) satisfies z.ZodType<GameGraphData>;
