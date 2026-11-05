import type { Database } from "../../db/pool";
import type { agentMemories } from "../../db/schema";
import type { ChatMessage } from "../../llm/types";

/** agent memory 的一条消息；`type` 与 LLM 的 ChatMessage 对应。 */
export type AgentMemoryMessageState = {
  sequence: number;
  type: "system" | "human" | "ai" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: unknown;
  metadata?: unknown;
  createdAt: string;
};

/** 一个 owner（actor / stage / world）的记忆快照；`contextUsageRatio` 是压缩前的使用率。 */
export type AgentMemoryState = {
  id: string;
  ownerType: string;
  ownerId: string;
  name: string;
  contextUsageRatio: number;
  messages: AgentMemoryMessageState[];
};

export type MemoryOwnerType = "actor" | "stage" | "world";

/** 记忆读写只要这三件事；不暴露整张 Database。 */
export type MemoryExecutor = Pick<Database, "select" | "insert" | "update">;

export type MemoryRow = typeof agentMemories.$inferSelect;

/** 下一轮 prompt 要用的形态：只有消息，不带序号与时间。 */
export type LoadedMemory = {
  row: MemoryRow;
  messages: ChatMessage[];
};
