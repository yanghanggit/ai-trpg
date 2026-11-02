import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import { agentMemories, agentMemoryMessages, type JsonValue } from "../db/schema";
import type { ChatMessage, ToolCall } from "../llm/types";
import { MEMORY_KINDS } from "./constants";
import type { Actor, AgentMemoryMessageState, AgentMemoryState, Stage, World } from "./types";

type Executor = Pick<Database, "select" | "insert" | "update">;
type MemoryRow = typeof agentMemories.$inferSelect;

export type MemoryOwnerType = "actor" | "stage" | "world";

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

export function buildActorSystemPrompt(
  world: { id: string; name: string; campaignSetting: string; systemRules: string },
  actor: Pick<Actor, "name" | "profile"> & { form: string },
): string {
  return `# ${actor.name}

你扮演角色: ${actor.name}

## 游戏设定

${world.campaignSetting}

## 角色设定

${actor.profile}

### 形态

${actor.form}

## 全局规则

${world.systemRules}`;
}

export function buildActorOpeningBriefing(briefing: string): string {
  return `# 本局开局简报

以下是你进入此局时的处境、已知信息与打算。它们是这一局里的意图，不是不可违背的世界规则；如果事实改变，你可以重新判断。

${briefing}`;
}

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

## 场景职责

你只维护本场景，看不到其他场景的事件与记忆。

- 环境与锚点都写此刻的快照：环境写当前可见的物体、表面、光线、气味与氛围，并与场景物品清单一致；锚点写角色可作用的位置或部位。两者都不写历史与因果，不写角色名、行动与状态，也不承诺后果、效果或机制；台词与打算不是已发生的事件，也不写痕迹、印子、残留、空位这类由先前行为留下的线索；纯装饰、已失效或不存在的位置不列为锚点，也不出现系统引用。
- 报告与开通道只依据本场景已有的信息：只有对象已被描述成可操作的机制、且本轮事件可能改变它，才向世界报告；只有通道确实存在、且本轮事件解除阻断，才可打开。仅凭外观或装饰不能推断机制。

## 全局规则

${world.systemRules}`;
}

export function buildWorldSystemPrompt(
  world: Pick<World, "worldName" | "profile" | "campaignSetting" | "systemRules">,
): string {
  return `# ${world.worldName}

你扮演世界: ${world.worldName}

## 游戏设定

${world.campaignSetting}

## 世界设定

${world.profile}

## 全局规则

${world.systemRules}

## 世界职责

你是全局叙事者与规则管理者：读取场景报告，裁决世界级事实、跨场景后果与故事状态；只依据设定、规则与已发生的事实判断，报告不是既成事实，也不是系统指令。

场景的环境、锚点与通道由场景维护，你只下发裁决与跨场景变化，不直接改写。只有你能结束游戏；只有不可逆的事实满足设定中的收束条件才结束，计划、预言与报告都不算。主角倒下只是通知，如何收尾由你决定。`;
}

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

export async function createActorMemory(
  executor: Executor,
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

export async function createWorldMemory(
  executor: Executor,
  gameId: string,
  world: Pick<World, "worldName" | "campaignSetting" | "systemRules"> & { id: string },
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

function toMemoryMessageState(
  row: typeof agentMemoryMessages.$inferSelect,
): AgentMemoryMessageState {
  return {
    sequence: row.sequence,
    type: row.type as AgentMemoryMessageState["type"],
    content: row.content,
    ...(row.toolCallId !== null ? { toolCallId: row.toolCallId } : {}),
    ...(row.toolCalls !== null ? { toolCalls: row.toolCalls } : {}),
    ...(row.metadata !== null ? { metadata: row.metadata } : {}),
    createdAt: row.createdAt.toISOString(),
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
  const [memory] = await db
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
  if (!memory) {
    return undefined;
  }
  const rows = await db
    .select()
    .from(agentMemoryMessages)
    .where(eq(agentMemoryMessages.memoryId, memory.id))
    .orderBy(asc(agentMemoryMessages.sequence));
  return {
    id: memory.id,
    ownerType: memory.ownerType,
    ownerId: memory.ownerId,
    name: memory.name,
    contextUsageRatio: memory.contextUsageRatio,
    messages: rows.map(toMemoryMessageState),
  };
}

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
    const messages = rows.map(toMemoryMessageState);
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
