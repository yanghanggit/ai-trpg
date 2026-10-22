import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import { agentMemories, agentMemoryMessages, type JsonValue } from "../db/schema";
import type { ChatMessage, ToolCall } from "../llm/types";
import { MEMORY_KINDS } from "./actions";
import type { Actor, AgentMemoryMessageState, AgentMemoryState } from "./types";

type Executor = Pick<Database, "select" | "insert" | "update">;
type MemoryRow = typeof agentMemories.$inferSelect;

export type LoadedMemory = {
  row: MemoryRow;
  messages: ChatMessage[];
};

function jsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function toChatMessage(row: typeof agentMemoryMessages.$inferSelect): ChatMessage {
  switch (row.type) {
    case "system":
      return {
        type: "system",
        content: row.content,
        ...(row.metadata !== null ? { metadata: row.metadata as Record<string, unknown> } : {}),
      };
    case "human":
      return {
        type: "human",
        content: row.content,
        ...(row.metadata !== null ? { metadata: row.metadata as Record<string, unknown> } : {}),
      };
    case "ai":
      return {
        type: "ai",
        content: row.content,
        ...(row.toolCalls !== null ? { toolCalls: row.toolCalls as unknown as ToolCall[] } : {}),
        ...(row.metadata !== null ? { metadata: row.metadata as Record<string, unknown> } : {}),
      };
    case "tool":
      if (row.toolCallId === null) {
        throw new Error(`tool 记忆消息缺少 tool_call_id: ${row.id}`);
      }
      return {
        type: "tool",
        content: row.content,
        toolCallId: row.toolCallId,
        ...(row.metadata !== null ? { metadata: row.metadata as Record<string, unknown> } : {}),
      };
    default:
      throw new Error(`未知记忆消息类型: ${row.type}`);
  }
}

function toRow(memoryId: string, sequence: number, message: ChatMessage) {
  const base = {
    id: randomUUID(),
    memoryId,
    sequence,
    type: message.type,
    content: message.content,
    metadata: message.metadata === undefined ? null : jsonValue(message.metadata),
  };

  if (message.type === "ai") {
    return {
      ...base,
      toolCalls: message.toolCalls === undefined ? null : jsonValue(message.toolCalls),
      toolCallId: null,
    };
  }
  if (message.type === "tool") {
    return { ...base, toolCalls: null, toolCallId: message.toolCallId };
  }
  return { ...base, toolCalls: null, toolCallId: null };
}

/** 构造 actor 的稳定 system prompt（世界设定、角色与规则）。 */
export function buildActorSystemPrompt(
  world: { id: string; name: string; campaignSetting: string; systemRules: string },
  actor: Pick<Actor, "name" | "profile" | "appearance">,
): string {
  return [
    "# 游戏设定",
    world.campaignSetting,
    "",
    "# 你的角色",
    `你是${actor.name}。`,
    actor.profile,
    `外观：${actor.appearance}`,
    "",
    "# 全局规则",
    world.systemRules,
    "",
    "# 行动方式",
    "你是一个自主行动的 NPC。每轮根据当前环境、自己的记忆与目标决定行动，并通过工具提交计划。",
  ].join("\n");
}

/** 创建 actor memory 并写入 system prompt。 */
export async function createActorMemory(
  executor: Executor,
  gameId: string,
  actor: Pick<Actor, "name" | "profile" | "appearance"> & { id: string },
  systemPrompt: string,
): Promise<MemoryRow> {
  const memoryId = randomUUID();
  const [memory] = await executor
    .insert(agentMemories)
    .values({
      id: memoryId,
      gameId,
      ownerType: "actor",
      ownerId: actor.id,
      name: actor.name,
    })
    .returning();
  if (!memory) {
    throw new Error(`创建 agent memory 失败: ${actor.name}`);
  }

  await executor.insert(agentMemoryMessages).values({
    id: randomUUID(),
    memoryId,
    sequence: 1,
    type: "system",
    content: systemPrompt,
    toolCalls: null,
    toolCallId: null,
    metadata: { kind: MEMORY_KINDS.actorSystemPrompt },
  });

  return memory;
}

/** 按 game 与 actor id 读取持久 memory；不存在时返回 undefined。 */
export async function loadAgentMemory(
  db: Pick<Database, "select">,
  gameId: string,
  ownerId: string,
): Promise<LoadedMemory | undefined> {
  const [row] = await db
    .select()
    .from(agentMemories)
    .where(
      and(
        eq(agentMemories.gameId, gameId),
        eq(agentMemories.ownerType, "actor"),
        eq(agentMemories.ownerId, ownerId),
      ),
    )
    .limit(1);
  if (!row) {
    return undefined;
  }

  const rows = await db
    .select()
    .from(agentMemoryMessages)
    .where(eq(agentMemoryMessages.memoryId, row.id))
    .orderBy(asc(agentMemoryMessages.sequence));

  return { row, messages: rows.map(toChatMessage) };
}

/** 在 memory 末尾追加消息并返回追加条数。 */
export async function appendMemoryMessages(
  executor: Executor,
  memoryId: string,
  messages: readonly ChatMessage[],
): Promise<number> {
  if (messages.length === 0) {
    return 0;
  }

  const [maxRow] = await executor
    .select({ value: sql<number>`coalesce(max(${agentMemoryMessages.sequence}), 0)` })
    .from(agentMemoryMessages)
    .where(eq(agentMemoryMessages.memoryId, memoryId));
  let sequence = Number(maxRow?.value ?? 0);

  const rows = messages.map((message) => {
    sequence += 1;
    return toRow(memoryId, sequence, message);
  });
  await executor.insert(agentMemoryMessages).values(rows);
  await executor
    .update(agentMemories)
    .set({ updatedAt: new Date() })
    .where(eq(agentMemories.id, memoryId));

  return rows.length;
}

/** 读取一局游戏内全部 actor memory，按 actor 名称排序。 */
export async function getGameMemories(db: Database, gameId: string): Promise<AgentMemoryState[]> {
  const memories = await db
    .select()
    .from(agentMemories)
    .where(eq(agentMemories.gameId, gameId))
    .orderBy(asc(agentMemories.name));
  const states: AgentMemoryState[] = [];

  for (const memory of memories) {
    const rows = await db
      .select()
      .from(agentMemoryMessages)
      .where(eq(agentMemoryMessages.memoryId, memory.id))
      .orderBy(asc(agentMemoryMessages.sequence));
    const messages: AgentMemoryMessageState[] = rows.map((row) => ({
      sequence: row.sequence,
      type: row.type as AgentMemoryMessageState["type"],
      content: row.content,
      ...(row.toolCallId !== null ? { toolCallId: row.toolCallId } : {}),
      ...(row.toolCalls !== null ? { toolCalls: row.toolCalls } : {}),
      ...(row.metadata !== null ? { metadata: row.metadata } : {}),
      createdAt: row.createdAt.toISOString(),
    }));
    states.push({
      id: memory.id,
      ownerType: memory.ownerType,
      ownerId: memory.ownerId,
      name: memory.name,
      contextUsageRatio: memory.contextUsageRatio,
      messages,
    });
  }

  return states;
}
