import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../db/pool";
import { agentMemories, agentMemoryMessages } from "../../db/schema";
import type { ChatMessage } from "../../llm/types";
import { MEMORY_KINDS } from "../constants";
import type { Actor, Stage, World } from "../world-definition";
import { buildActorOpeningBriefing } from "./prompts";
import { type MessageRow, toChatMessage, toMemoryMessageState, toRow } from "./rows";
import type {
  AgentMemoryState,
  LoadedMemory,
  MemoryExecutor,
  MemoryOwnerType,
  MemoryRow,
} from "./types";

async function createMemory(
  executor: MemoryExecutor,
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

export async function createActorMemory(
  executor: MemoryExecutor,
  gameId: string,
  actor: Pick<Actor, "name" | "profile" | "openingBriefing"> & { id: string; form: string },
  systemPrompt: string,
): Promise<MemoryRow> {
  const memory = await createMemory(
    executor,
    gameId,
    "actor",
    actor,
    systemPrompt,
    MEMORY_KINDS.actorSystemPrompt,
  );
  const openingBriefing = actor.openingBriefing?.trim();
  if (openingBriefing) {
    await appendMemoryMessages(executor, memory.id, [
      {
        type: "human",
        content: buildActorOpeningBriefing(openingBriefing),
        metadata: { kind: MEMORY_KINDS.actorOpeningBriefing },
      },
    ]);
  }
  return memory;
}

export async function createStageMemory(
  executor: MemoryExecutor,
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

export async function createWorldMemory(
  executor: MemoryExecutor,
  gameId: string,
  world: Pick<World, "worldName" | "campaignSetting" | "globalRules"> & { id: string },
  systemPrompt: string,
): Promise<MemoryRow> {
  return createMemory(
    executor,
    gameId,
    "world",
    { id: world.id, name: world.worldName },
    systemPrompt,
    MEMORY_KINDS.worldSystemPrompt,
  );
}

export async function loadAgentMemory(
  db: Pick<Database, "select">,
  gameId: string,
  ownerType: MemoryOwnerType,
  ownerId: string,
): Promise<LoadedMemory | undefined> {
  const row = await findMemoryRow(db, gameId, ownerType, ownerId);
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

async function findMemoryRow(
  db: Pick<Database, "select">,
  gameId: string,
  ownerType: MemoryOwnerType,
  ownerId: string,
): Promise<MemoryRow | undefined> {
  const rows = await db
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
  return rows[0];
}

function latestContextUsageRatio(messages: readonly ChatMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== "ai") {
      continue;
    }
    const raw = message.metadata?.contextUsageRatio;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return undefined;
}

/**
 * 序号按「当前最大值 + 1」分配，(memory_id, sequence) 上有唯一索引：并发追加会显式失败，
 * 不会静默错序。调用方负责把同一 owner 的写入串行化（回合已持有 game 行锁）。
 */
export async function appendMemoryMessages(
  executor: MemoryExecutor,
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
  const contextUsageRatio = latestContextUsageRatio(messages);
  await executor
    .update(agentMemories)
    .set({
      updatedAt: new Date(),
      ...(contextUsageRatio === undefined ? {} : { contextUsageRatio }),
    })
    .where(eq(agentMemories.id, memoryId));

  return rows.length;
}

function toMemoryState(memory: MemoryRow, rows: readonly MessageRow[]): AgentMemoryState {
  return {
    id: memory.id,
    ownerType: memory.ownerType,
    ownerId: memory.ownerId,
    name: memory.name,
    contextUsageRatio: memory.contextUsageRatio,
    messages: rows.map(toMemoryMessageState),
  };
}

/**
 * 单个 owner 的记忆投影。
 *
 * 与 `loadAgentMemory` 的区别是带序号与时间：它面向“给人看的日志”，不面向下一轮 prompt。
 */
export async function getMemoryState(
  db: Database,
  gameId: string,
  ownerType: MemoryOwnerType,
  ownerId: string,
): Promise<AgentMemoryState | undefined> {
  const memory = await findMemoryRow(db, gameId, ownerType, ownerId);
  if (!memory) {
    return undefined;
  }
  const rows = await db
    .select()
    .from(agentMemoryMessages)
    .where(eq(agentMemoryMessages.memoryId, memory.id))
    .orderBy(asc(agentMemoryMessages.sequence));
  return toMemoryState(memory, rows);
}

/** 一局全部 owner 的记忆投影；消息一次取回，不做 per-owner 查询。 */
export async function getGameMemories(db: Database, gameId: string): Promise<AgentMemoryState[]> {
  const memories = await db
    .select()
    .from(agentMemories)
    .where(eq(agentMemories.gameId, gameId))
    .orderBy(asc(agentMemories.name));
  if (memories.length === 0) {
    return [];
  }

  const rows = await db
    .select()
    .from(agentMemoryMessages)
    .where(
      inArray(
        agentMemoryMessages.memoryId,
        memories.map((memory) => memory.id),
      ),
    )
    .orderBy(asc(agentMemoryMessages.sequence));

  const byMemory = new Map<string, MessageRow[]>();
  for (const row of rows) {
    const list = byMemory.get(row.memoryId);
    if (list) {
      list.push(row);
    } else {
      byMemory.set(row.memoryId, [row]);
    }
  }

  return memories.map((memory) => toMemoryState(memory, byMemory.get(memory.id) ?? []));
}
