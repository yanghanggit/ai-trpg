/**
 * 与具体 provider 无关的 chat completion 数据类型。
 *
 * 命名对齐 OpenAI / DeepSeek 的 `POST /chat/completions`：一次请求 = 给定消息
 * 历史 + 本轮用户输入，让模型**补全**下一条 assistant 消息；返回的就是那条补全结果。
 *
 * 内部字段用 camelCase；DeepSeek 的 snake_case 只在 `deepseek/client.ts` 的
 * payload / response 边界转换。这样业务代码不需要记住 provider 的命名习惯。
 */

import type { ChatError } from "./errors";

/** tool_choice 取值（OpenAI 兼容）。 */
export type ToolChoice = "auto" | "none" | "required";

/** reasoning_effort 取值（DeepSeek 思考模式档位）。 */
export type ReasoningEffort = "low" | "high" | "max";

/** 工具函数参数的 JSON Schema 描述（对应 DeepSeek/OpenAI tools[].function）。 */
export type ToolFunction = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** 单个工具定义，对应 DeepSeek/OpenAI tools 数组的一个元素。 */
export type ToolDefinition = {
  type: "function";
  function: ToolFunction;
};

/** LLM 返回的单次工具调用指令（finishReason == "tool_calls" 时存在）。 */
export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON 序列化的参数字符串。 */
    arguments: string;
  };
};

/** 响应中的 token 用量统计。 */
export type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  reasoningTokens: number;
};

/** 业务 / 调试标记，随消息一起序列化（等价于 Python 版的 extra="allow"）。 */
export type MessageMetadata = Record<string, unknown>;

export type SystemMessage = {
  type: "system";
  content: string;
  metadata?: MessageMetadata;
};

export type HumanMessage = {
  type: "human";
  content: string;
  metadata?: MessageMetadata;
};

export type AIMessage = {
  type: "ai";
  content: string;
  metadata?: MessageMetadata;
  /** 模型发起的工具调用；回传给下一轮时由 provider 转成 wire 格式。 */
  toolCalls?: ToolCall[];
  /** thinking 模式下的推理内容；不参与后续请求。 */
  reasoningContent?: string;
};

export type ToolMessage = {
  type: "tool";
  content: string;
  metadata?: MessageMetadata;
  /** 对应 LLM 发出的 ToolCall.id。 */
  toolCallId: string;
};

export type ChatMessage = SystemMessage | HumanMessage | AIMessage | ToolMessage;

export function isHumanMessage(message: ChatMessage): message is HumanMessage {
  return message.type === "human";
}

export function isAIMessage(message: ChatMessage): message is AIMessage {
  return message.type === "ai";
}

export function isToolMessage(message: ChatMessage): message is ToolMessage {
  return message.type === "tool";
}

export type ChatCompletionRequestInit = {
  label: string;
  inputMessage: string;
  messages: readonly ChatMessage[];
  model?: string;
  thinking?: boolean;
  /** 单次请求超时，单位毫秒；默认由 provider 决定。 */
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  tools?: readonly ToolDefinition[];
  toolChoice?: ToolChoice;
  reasoningEffort?: ReasoningEffort;
  /** 是否允许把本次请求 / 响应落盘到 `logs/llm/`，默认 true。 */
  dump?: boolean;
};

/**
 * 一次 chat completion 请求（不可变值对象）。
 *
 * Python 版用冻结 dataclass + `assert`；这里用显式校验，避免 `python -O`
 * 之类「校验被静默关闭」的问题，也给调用方明确的 TypeError / RangeError。
 */
export class ChatCompletionRequest {
  readonly label: string;
  readonly inputMessage: string;
  readonly messages: readonly ChatMessage[];
  readonly model: string | undefined;
  readonly thinking: boolean;
  readonly timeoutMs: number | undefined;
  readonly temperature: number | undefined;
  readonly maxTokens: number | undefined;
  readonly tools: readonly ToolDefinition[];
  readonly toolChoice: ToolChoice | undefined;
  readonly reasoningEffort: ReasoningEffort | undefined;
  readonly dump: boolean;

  constructor(init: ChatCompletionRequestInit) {
    if (init.label.length === 0) {
      throw new TypeError("label 不能为空");
    }
    const tools = init.tools ?? [];
    if (init.inputMessage.length === 0 && tools.length === 0) {
      throw new TypeError("没有 tools 时 inputMessage 不能为空");
    }
    if (init.timeoutMs !== undefined && (!Number.isFinite(init.timeoutMs) || init.timeoutMs <= 0)) {
      throw new RangeError("timeoutMs 必须为正数");
    }
    if (
      init.maxTokens !== undefined &&
      (!Number.isInteger(init.maxTokens) || init.maxTokens <= 0)
    ) {
      throw new RangeError("maxTokens 必须为正整数");
    }
    if (
      init.temperature !== undefined &&
      (!Number.isFinite(init.temperature) || init.temperature < 0)
    ) {
      throw new RangeError("temperature 不能为负数");
    }

    this.label = init.label;
    this.inputMessage = init.inputMessage;
    this.messages = init.messages;
    this.model = init.model;
    this.thinking = init.thinking ?? false;
    this.timeoutMs = init.timeoutMs;
    this.temperature = init.temperature;
    this.maxTokens = init.maxTokens;
    this.tools = tools;
    this.toolChoice = init.toolChoice;
    this.reasoningEffort = init.reasoningEffort;
    this.dump = init.dump ?? true;

    Object.freeze(this);
  }
}

export type ChatCompletionResultInit = {
  request: ChatCompletionRequest;
  aiMessage?: AIMessage;
  finishReason?: string;
  toolCalls?: readonly ToolCall[];
  usage?: Usage;
  error?: ChatError;
  elapsedMs?: number;
};

/**
 * 一次 chat completion 的结果（不可变值对象）。
 *
 * `error` 是唯一的失败通道：预期内的通讯失败（超时/连接/非 200）不抛异常，
 * 而是落在 `error` 上，因此批量场景不需要再靠 client 旁路对账。
 */
export class ChatCompletionResult {
  readonly request: ChatCompletionRequest;
  readonly aiMessage: AIMessage | undefined;
  readonly finishReason: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage: Usage | undefined;
  readonly error: ChatError | undefined;
  readonly elapsedMs: number;

  constructor(init: ChatCompletionResultInit) {
    this.request = init.request;
    this.aiMessage = init.aiMessage;
    this.finishReason = init.finishReason ?? "";
    this.toolCalls = init.toolCalls ?? [];
    this.usage = init.usage;
    this.error = init.error;
    this.elapsedMs = init.elapsedMs ?? 0;

    Object.freeze(this);
  }

  get label(): string {
    return this.request.label;
  }

  get ok(): boolean {
    return this.error === undefined;
  }

  get content(): string {
    return this.aiMessage?.content ?? "";
  }

  get reasoningContent(): string {
    return this.aiMessage?.reasoningContent ?? "";
  }
}
