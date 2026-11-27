/**
 * 旁路读的线上契约：一条消息、一份 owner 的记忆、一次探针的答复。
 *
 * 消息是这条链路上唯一需要逐字段读的东西（类型、正文、工具调用），所以它具名；
 * `game` 那一层另有契约，这里原样透传，不抄第二份游戏元信息。
 */

import { z } from "zod";

export const memoryMessageSchema = z
  .object({
    sequence: z.number(),
    type: z.enum(["system", "human", "ai", "tool"]),
    content: z.string(),
    toolCallId: z.string().optional(),
    toolCalls: z.unknown().optional(),
    metadata: z.unknown().optional(),
    createdAt: z.string(),
  })
  .meta({ id: "GameMemoryMessage" });

export const gameMemorySchema = z
  .object({
    owner: z.object({
      ownerType: z.string(),
      ownerId: z.string(),
      name: z.string(),
    }),
    game: z.record(z.string(), z.unknown()),
    memory: z.object({
      id: z.string(),
      ownerType: z.string(),
      ownerId: z.string(),
      name: z.string(),
      contextUsageRatio: z.number(),
      messages: z.array(memoryMessageSchema),
    }),
    messages: z.number(),
  })
  .meta({ id: "GameMemory" });

export const gameProbeSchema = z
  .object({
    targetType: z.enum(["actor", "stage", "world"]),
    targetName: z.string(),
    answer: z.string(),
    finishReason: z.string().nullable(),
  })
  .meta({ id: "GameProbe" });
