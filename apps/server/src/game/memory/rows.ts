import { randomUUID } from "node:crypto";
import type { agentMemoryMessages, JsonValue } from "../../db/schema";
import type { ChatMessage, ToolCall } from "../../llm/types";
import type { AgentMemoryMessageState } from "./types";

export type MessageRow = typeof agentMemoryMessages.$inferSelect;

function jsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export function toChatMessage(row: MessageRow): ChatMessage {
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

export function toRow(memoryId: string, sequence: number, message: ChatMessage) {
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

export function toMemoryMessageState(row: MessageRow): AgentMemoryMessageState {
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
