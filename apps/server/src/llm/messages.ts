/** 消息序列的纯函数工具（调试、日志、transcript 共用）。 */

import type { ChatMessage, ToolCall } from "./types";

export type BufferStringOptions = {
  systemPrefix?: string;
  humanPrefix?: string;
  aiPrefix?: string;
  toolPrefix?: string;
  /** 是否把 AI 消息的 tool_calls 一并渲染出来。 */
  renderToolCalls?: boolean;
};

function formatToolCalls(toolCalls: readonly ToolCall[] | undefined): string {
  if (!toolCalls || toolCalls.length === 0) {
    return "";
  }
  return [
    "[tool_calls]",
    ...toolCalls.map((tc) => `  ↳ ${tc.function.name}(${tc.function.arguments})`),
  ].join("\n");
}

/** 把消息序列转换为单一字符串（用于调试、日志或 prompt 拼接）。 */
export function getBufferString(
  messages: readonly ChatMessage[],
  options: BufferStringOptions = {},
): string {
  const {
    systemPrefix = "System",
    humanPrefix = "Human",
    aiPrefix = "AI",
    toolPrefix = "Tool",
    renderToolCalls = false,
  } = options;

  return messages
    .map((message) => {
      let role: string;
      switch (message.type) {
        case "system":
          role = systemPrefix;
          break;
        case "human":
          role = humanPrefix;
          break;
        case "ai":
          role = aiPrefix;
          break;
        case "tool":
          role = toolPrefix;
          break;
      }

      let content = message.content;
      if (renderToolCalls && message.type === "ai") {
        const calls = formatToolCalls(message.toolCalls);
        if (calls) {
          content = content.length > 0 ? `${content}\n${calls}` : calls;
        }
      }

      return `${role}: ${content}`;
    })
    .join("\n");
}
