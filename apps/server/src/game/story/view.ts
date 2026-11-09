import { findActorByName } from "../actor-state";
import { GameError } from "../errors";
import type { AgentMemoryMessageState, AgentMemoryState } from "../memory";
import { findStage } from "../stage-state";
import type { GameState } from "../types";

/**
 * 故事 agent 的读取视图：把记忆与事件流渲染成它能读的文本。
 *
 * 记忆是分层的（当前摘要 + compact 归档），是否展开由 agent 的 `includeArchived` 决定；
 * 事件流永远是全量、按 sequence 排。渲染只读 state 与已加载的记忆，不碰数据库。
 */

function asArchivedMessages(metadata: unknown): AgentMemoryMessageState[] | undefined {
  if (typeof metadata !== "object" || metadata === null) {
    return undefined;
  }
  const value = (metadata as Record<string, unknown>).compactedMessages;
  return Array.isArray(value) ? (value as AgentMemoryMessageState[]) : undefined;
}

function archivedCount(memory: AgentMemoryState): number {
  return memory.messages.reduce(
    (total, message) => total + (asArchivedMessages(message.metadata)?.length ?? 0),
    0,
  );
}

function formatMessage(
  message: AgentMemoryMessageState,
  options: { includeArchived: boolean; depth: number },
): string[] {
  const indent = "  ".repeat(options.depth);
  const lines = [`${indent}[${message.type}] ${message.content}`];
  if (!options.includeArchived) {
    return lines;
  }
  const archived = asArchivedMessages(message.metadata);
  if (!archived) {
    return lines;
  }
  lines.push(`${indent}  ↳ 归档：${archived.length} 条旧消息`);
  for (const old of archived) {
    lines.push(...formatMessage(old, { includeArchived: true, depth: options.depth + 2 }));
  }
  return lines;
}

export function formatMemory(memory: AgentMemoryState, includeArchived: boolean): string {
  const lines = [`# ${memory.ownerType}: ${memory.name}`, ""];
  for (const message of memory.messages) {
    if (message.type === "system") {
      continue;
    }
    lines.push(...formatMessage(message, { includeArchived, depth: 0 }));
  }
  if (memory.messages.every((message) => message.type === "system")) {
    lines.push("（暂无运行记忆）");
  }
  if (!includeArchived && archivedCount(memory) > 0) {
    lines.push("", `（另有 ${archivedCount(memory)} 条历史归档，可用 includeArchived 展开）`);
  }
  return lines.join("\n");
}

export function resolveMemory(
  memories: readonly AgentMemoryState[],
  ownerType: string,
  name: string,
): AgentMemoryState {
  const found = memories.find((memory) => memory.ownerType === ownerType && memory.name === name);
  if (!found) {
    throw new GameError("invalid_action", `找不到记忆实体: ${ownerType}:${name}`);
  }
  return found;
}

export function entityProfile(state: GameState, ownerType: string, name: string): string {
  switch (ownerType) {
    case "actor":
      return findActorByName(state, name).actor.profile;
    case "stage":
      return findStage(state, name).profile;
    case "world":
      return state.world.campaignSetting;
    default:
      throw new GameError("invalid_action", `未知实体类型: ${ownerType}`);
  }
}

/** `list_memories` 的输出：每个实体一行，带上记忆体量与压缩水位。 */
export function renderMemoryList(memories: readonly AgentMemoryState[]): string {
  return memories
    .map((memory) => {
      const archive = archivedCount(memory);
      return `${memory.ownerType} | ${memory.name} | messages=${memory.messages.length} | ratio=${memory.contextUsageRatio.toFixed(4)} | archived=${archive}`;
    })
    .join("\n");
}

/** `read_memory` 的输出：实体设定在前，记忆在后；归档按需展开。 */
export function renderMemoryRead(
  state: GameState,
  memory: AgentMemoryState,
  includeArchived: boolean,
): string {
  const profile = entityProfile(state, memory.ownerType, memory.name);
  return `# ${memory.ownerType}: ${memory.name}\n\n## 实体设定\n${profile}\n\n## 记忆\n${formatMemory(
    memory,
    includeArchived,
  )}`;
}

/** `read_events` 的输出：全量事件流，id 换成当前名字，读得懂才写得进故事。 */
export function renderEventStream(state: GameState): string {
  const actors = new Map(
    state.world.stages.flatMap((stage) =>
      stage.actors.map((actor) => [actor.id, actor.name] as const),
    ),
  );
  const stages = new Map(state.world.stages.map((stage) => [stage.id, stage.name] as const));
  return state.messages
    .map((message) => {
      const stage = message.stageId ? (stages.get(message.stageId) ?? message.stageId) : "-";
      const source = message.sourceActorId
        ? (actors.get(message.sourceActorId) ?? message.sourceActorId)
        : "-";
      const target = message.targetActorId
        ? (actors.get(message.targetActorId) ?? message.targetActorId)
        : "-";
      return `[${message.sequence}] ${message.kind} | stage=${stage} | source=${source} | target=${target} | visibility=${message.visibility}\n${message.content}`;
    })
    .join("\n\n");
}
