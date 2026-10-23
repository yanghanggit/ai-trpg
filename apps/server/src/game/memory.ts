import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import { agentMemories, agentMemoryMessages, type JsonValue } from "../db/schema";
import type { ChatMessage, ToolCall } from "../llm/types";
import { MEMORY_KINDS } from "./constants";
import type { Actor, AgentMemoryMessageState, AgentMemoryState, Stage } from "./types";

type Executor = Pick<Database, "select" | "insert" | "update">;
type MemoryRow = typeof agentMemories.$inferSelect;

export type MemoryOwnerType = "actor" | "stage";

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

/** 构造 actor 的稳定 system prompt：实体标题、游戏设定、角色设定与全局规则。 */
export function buildActorSystemPrompt(
  world: { id: string; name: string; campaignSetting: string; systemRules: string },
  actor: Pick<Actor, "name" | "profile" | "appearance">,
): string {
  return `# ${actor.name}

你扮演角色: ${actor.name}

## 游戏设定

${world.campaignSetting}

## 角色设定

${actor.profile}

### 基础体型

${actor.appearance}

## 全局规则

${world.systemRules}`;
}

/** 构造场景作为小 GM 的稳定 system prompt：实体标题、游戏设定、场景设定与职责。 */
export function buildStageSystemPrompt(
  world: { name: string; campaignSetting: string; systemRules: string },
  stage: Pick<Stage, "name" | "profile">,
): string {
  return `# ${stage.name}

你扮演场景: ${stage.name}

## 游戏设定

${world.campaignSetting}

## 场景设定

${stage.profile}

## 全局规则

${world.systemRules}`;
}

/** 创建 memory 并写入 system prompt。 */
async function createMemory(
  executor: Executor,
  gameId: string,
  ownerType: MemoryOwnerType,
  owner: { id: string; name: string },
  systemPrompt: string,
  systemPromptKind: string,
): Promise<MemoryRow> {
  const memoryId = randomUUID();
  const [memory] = await executor
    .insert(agentMemories)
    .values({
      id: memoryId,
      gameId,
      ownerType,
      ownerId: owner.id,
      name: owner.name,
    })
    .returning();
  if (!memory) {
    throw new Error(`创建 agent memory 失败: ${owner.name}`);
  }

  await executor.insert(agentMemoryMessages).values({
    id: randomUUID(),
    memoryId,
    sequence: 1,
    type: "system",
    content: systemPrompt,
    toolCalls: null,
    toolCallId: null,
    metadata: { kind: systemPromptKind },
  });

  return memory;
}

/** 创建 actor memory 并写入 system prompt。 */
export async function createActorMemory(
  executor: Executor,
  gameId: string,
  actor: Pick<Actor, "name" | "profile" | "appearance"> & { id: string },
  systemPrompt: string,
): Promise<MemoryRow> {
  return createMemory(
    executor,
    gameId,
    "actor",
    actor,
    systemPrompt,
    MEMORY_KINDS.actorSystemPrompt,
  );
}

/** 创建 stage memory 并写入小 GM system prompt。 */
export async function createStageMemory(
  executor: Executor,
  gameId: string,
  stage: Pick<Stage, "name" | "profile"> & { id: string },
  systemPrompt: string,
): Promise<MemoryRow> {
  return createMemory(
    executor,
    gameId,
    "stage",
    stage,
    systemPrompt,
    MEMORY_KINDS.stageSystemPrompt,
  );
}

/** 按 game、owner 类型与 owner id 读取持久 memory；不存在时返回 undefined。 */
export async function loadAgentMemory(
  db: Pick<Database, "select">,
  gameId: string,
  ownerType: MemoryOwnerType,
  ownerId: string,
): Promise<LoadedMemory | undefined> {
  const [row] = await db
    .select()
    .from(agentMemories)
    .where(
      and(
        eq(agentMemories.gameId, gameId),
        eq(agentMemories.ownerType, ownerType),
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
