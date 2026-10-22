/**
 * DeepSeek provider 实现 + 默认 provider 绑定。
 *
 * - `DeepSeekClient`：直连 DeepSeek 平台的实现（provider 私有细节都在 client.ts）；
 * - `DEEPSEEK_SERVICE`：全项目共用的默认实例（无状态，可复用）；
 * - `agentLoop` / `batchComplete`：已绑定默认实例的编排入口；
 * - 其它名字（工具类型 / 错误）转发自 `llm`，让业务侧只需从一个入口导入。
 */

export {
  type AIMessage,
  ChatCompletionRequest,
  ChatCompletionResult,
  type ChatCompletionService,
  type ChatMessage,
  type HumanMessage,
  type MessageMetadata,
  type ReasoningEffort,
  type SystemMessage,
  type ToolCall,
  type ToolChoice,
  type ToolDefinition,
  type ToolFunction,
  type ToolMessage,
  type Usage,
} from "../llm";
export {
  AgentLoopResult,
  type AgentLoopRound,
  agentLoop,
  type DeepSeekAgentLoopOptions,
} from "./agent-loop";
export { batchComplete, type DeepSeekBatchOptions } from "./batch";
export {
  DEEPSEEK_API_BASE_URL,
  DEEPSEEK_MODEL_FLASH,
  DEEPSEEK_MODEL_PRO,
  DEEPSEEK_SERVICE,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_DEEPSEEK_MAX_TOKENS,
  DEFAULT_DEEPSEEK_TEMPERATURE,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DeepSeekClient,
  type DeepSeekClientOptions,
  type FetchLike,
} from "./client";
export { ChatError, DeepSeekError, type ErrorKind } from "./errors";
