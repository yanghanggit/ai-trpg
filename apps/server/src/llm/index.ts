/**
 * chat completion 抽象层（provider 无关）。
 *
 * 这里放任何 LLM 供应商都能复用的东西：值对象、协议、错误模型、批量与
 * agent loop 编排。具体实现（当前是 DeepSeek）在 `src/deepseek`；
 * 依赖方向永远是 `deepseek -> llm`，本目录不得 import `deepseek`。
 */

export {
  type AgentLoopOptions,
  AgentLoopResult,
  type AgentLoopRound,
  agentLoop,
  LOOP_END_ATTR,
  LOOP_ID_ATTR,
  type ToolHandler,
} from "./agent-loop";
export { type BatchCompleteOptions, batchComplete } from "./batch";
export { ChatError, type ChatErrorOptions, type ErrorKind } from "./errors";
export { consoleLogger, type LlmLogger, silentLogger } from "./logger";
export { type BufferStringOptions, getBufferString } from "./messages";
export type { ChatCompletionService } from "./protocol";
export {
  type AIMessage,
  ChatCompletionRequest,
  type ChatCompletionRequestInit,
  ChatCompletionResult,
  type ChatCompletionResultInit,
  type ChatMessage,
  type HumanMessage,
  isAIMessage,
  isHumanMessage,
  isToolMessage,
  type MessageMetadata,
  type ReasoningEffort,
  type SystemMessage,
  type ToolCall,
  type ToolChoice,
  type ToolDefinition,
  type ToolFunction,
  type ToolMessage,
  type Usage,
} from "./types";
