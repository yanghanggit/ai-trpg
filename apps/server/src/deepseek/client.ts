/**
 * DeepSeek 直连客户端：无状态服务，只持有 provider 私有事实
 * （模型名、接口地址、鉴权与传输实现）。
 *
 * 预期内的失败收敛成 `ChatCompletionResult.error`；不打印完整响应正文，
 * 避免把 prompt / 回复写进生产日志。
 */

import { ChatError, type ErrorKind } from "../llm/errors";
import { type LlmLogger, silentLogger } from "../llm/logger";
import { saveTranscript, type TranscriptFormat } from "../llm/transcript";
import {
  type AIMessage,
  type ChatCompletionRequest,
  ChatCompletionResult,
  type ChatMessage,
  type MessageMetadata,
  type ToolCall,
  type Usage,
} from "../llm/types";

export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODEL_FLASH = "deepseek-flash";
export const DEEPSEEK_MODEL_PRO = "deepseek-v4-pro";

export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 30_000;
export const DEFAULT_DEEPSEEK_TEMPERATURE = 1.0;
export const DEFAULT_DEEPSEEK_MAX_TOKENS = 16_384;
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000;

const CHAT_COMPLETIONS_PATH = "/chat/completions";
const MODELS_PATH = "/models";
const BALANCE_PATH = "/user/balance";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type DeepSeekClientOptions = {
  /** 默认读 `DEEPSEEK_API_KEY`；显式传入时优先。 */
  apiKey?: string;
  /** 默认 `https://api.deepseek.com`。 */
  baseUrl?: string;
  /** 请求未指定 model 时使用，默认 `deepseek-flash`。 */
  defaultModel?: string;
  /** 测试注入点；默认使用 Node 22 的全局 fetch。 */
  fetch?: FetchLike;
  logger?: LlmLogger;
  dumpDir?: string;
  /** 显式覆盖 transcript 的进程级开关；主要供测试使用。 */
  dumpEnabled?: boolean;
  /** transcript 格式，默认 both（text + jsonl）。 */
  dumpFormat?: TranscriptFormat;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    return String((error as { name: unknown }).name);
  }
  return "";
}

function errorDescription(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.type) {
    case "system":
      return { role: "system", content: message.content };
    case "human":
      return { role: "user", content: message.content };
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    case "ai": {
      const wire: Record<string, unknown> = {
        role: "assistant",
        content: message.content.length > 0 ? message.content : null,
      };
      if (message.toolCalls && message.toolCalls.length > 0) {
        wire.tool_calls = message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: toolCall.type,
          function: {
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          },
        }));
      }
      return wire;
    }
  }
}

function parseToolCalls(raw: unknown): ToolCall[] {
  return asArray(raw).map((item, index) => {
    if (!isRecord(item)) {
      throw new TypeError(`tool_calls[${index}] 不是对象`);
    }
    const fn = isRecord(item.function) ? item.function : undefined;
    const id = asString(item.id);
    const name = asString(fn?.name);
    const args = asString(fn?.arguments);
    if (!id || !name || args === undefined) {
      throw new TypeError(`tool_calls[${index}] 缺少 id / function.name / function.arguments`);
    }
    return {
      id,
      type: "function",
      function: { name, arguments: args },
    };
  });
}

function parseUsage(raw: unknown): Usage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const details = isRecord(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
  return {
    promptTokens: asNumber(raw.prompt_tokens) ?? 0,
    completionTokens: asNumber(raw.completion_tokens) ?? 0,
    totalTokens: asNumber(raw.total_tokens) ?? 0,
    promptCacheHitTokens: asNumber(raw.prompt_cache_hit_tokens) ?? 0,
    promptCacheMissTokens: asNumber(raw.prompt_cache_miss_tokens) ?? 0,
    reasoningTokens: asNumber(details.reasoning_tokens) ?? 0,
  };
}

export class DeepSeekClient {
  static readonly MODEL_FLASH = DEEPSEEK_MODEL_FLASH;
  static readonly MODEL_PRO = DEEPSEEK_MODEL_PRO;

  static readonly CONTEXT_WINDOW_TOKENS: Readonly<Record<string, number>> = {
    [DEEPSEEK_MODEL_FLASH]: 1_000_000,
    [DEEPSEEK_MODEL_PRO]: 1_000_000,
  };

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: FetchLike;
  private readonly logger: LlmLogger;
  private readonly dumpDir: string | undefined;
  private readonly dumpEnabled: boolean | undefined;
  private readonly dumpFormat: TranscriptFormat | undefined;

  constructor(options: DeepSeekClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEEPSEEK_API_BASE_URL).replace(/\/+$/, "");
    this.defaultModel = options.defaultModel ?? DEEPSEEK_MODEL_FLASH;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.logger = options.logger ?? silentLogger;
    this.dumpDir = options.dumpDir;
    this.dumpEnabled = options.dumpEnabled;
    this.dumpFormat = options.dumpFormat;
  }

  /** 每次请求从环境变量读取 key，便于测试 / 轮换；缺失时抛配置错误。 */
  getApiKey(): string {
    const key = this.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key || key.trim().length === 0) {
      throw new Error("DEEPSEEK_API_KEY environment variable is not set");
    }
    return key;
  }

  contextWindow(model?: string): number {
    return (
      DeepSeekClient.CONTEXT_WINDOW_TOKENS[model ?? this.defaultModel] ??
      DEFAULT_CONTEXT_WINDOW_TOKENS
    );
  }

  async listModels(): Promise<string[]> {
    const apiKey = this.getApiKey();
    const data = await this.getJson(MODELS_PATH, apiKey, 10_000);
    if (!isRecord(data)) {
      return [];
    }
    return asArray(data.data)
      .map((item) => (isRecord(item) ? asString(item.id) : undefined))
      .filter((id): id is string => id !== undefined);
  }

  async getBalance(): Promise<Record<string, unknown>> {
    const apiKey = this.getApiKey();
    const data = await this.getJson(BALANCE_PATH, apiKey, 10_000);
    return isRecord(data) ? data : {};
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const apiKey = this.getApiKey();
    const startedAt = performance.now();
    this.logger.debug(`${request.label} request inputMessage:\n${request.inputMessage}`);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${CHAT_COMPLETIONS_PATH}`, {
        method: "POST",
        headers: this.headers(apiKey),
        body: JSON.stringify(this.buildPayload(request)),
        signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_DEEPSEEK_TIMEOUT_MS),
      });
    } catch (error) {
      const kind: ErrorKind =
        errorName(error) === "TimeoutError" || errorName(error) === "AbortError"
          ? "timeout"
          : "connection";
      this.logger.error(`${request.label}: ${kind} error: ${errorDescription(error)}`);
      return this.failed(request, kind, errorDescription(error), startedAt, undefined, error);
    }

    if (response.status !== 200) {
      const body = await response.text().catch(() => "");
      this.logger.error(`${request.label}: HTTP ${response.status}: ${body.slice(0, 500)}`);
      return this.failed(
        request,
        "api",
        `HTTP ${response.status}`,
        startedAt,
        response.status,
        undefined,
        body,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      return this.failed(
        request,
        "api",
        `响应不是合法 JSON: ${errorDescription(error)}`,
        startedAt,
        200,
        error,
      );
    }

    let result: ChatCompletionResult;
    try {
      result = this.parseResponse(request, data, startedAt);
    } catch (error) {
      return this.failed(
        request,
        "api",
        `响应解析失败: ${errorDescription(error)}`,
        startedAt,
        200,
        error,
        data,
      );
    }

    if (result.ok) {
      this.logger.debug(`${request.label} completion content:\n${result.content}`);
      if (result.reasoningContent.length > 0) {
        this.logger.debug(`${request.label} reasoning content:\n${result.reasoningContent}`);
      }
      await saveTranscript(request, result, {
        dir: this.dumpDir,
        enabled: this.dumpEnabled,
        format: this.dumpFormat,
        logger: this.logger,
      });
    }

    return result;
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  private async getJson(path: string, apiKey: string, timeoutMs: number): Promise<unknown> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: this.headers(apiKey),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200) {
        const body = await response.text().catch(() => "");
        this.logger.error(
          `DeepSeek GET ${path} failed (${response.status}): ${body.slice(0, 500)}`,
        );
        return undefined;
      }
      return await response.json();
    } catch (error) {
      this.logger.error(`DeepSeek GET ${path} request error: ${errorDescription(error)}`);
      return undefined;
    }
  }

  private buildPayload(request: ChatCompletionRequest): Record<string, unknown> {
    const messages: Array<Record<string, unknown>> = request.messages.map(toWireMessage);
    if (request.inputMessage.length > 0) {
      messages.push({ role: "user", content: request.inputMessage });
    }

    const hasTools = request.tools.length > 0;
    const payload: Record<string, unknown> = {
      messages,
      model: request.model ?? this.defaultModel,
      thinking: {
        type: request.thinking ? "enabled" : "disabled",
      },
      max_tokens: request.maxTokens ?? DEFAULT_DEEPSEEK_MAX_TOKENS,
      response_format: { type: "text" },
      stream: false,
      temperature: request.temperature ?? DEFAULT_DEEPSEEK_TEMPERATURE,
      tools: hasTools ? request.tools : undefined,
      tool_choice: request.toolChoice ?? (hasTools ? "required" : "none"),
    };

    if (request.reasoningEffort !== undefined) {
      payload.reasoning_effort = request.reasoningEffort;
    }
    return payload;
  }

  private parseResponse(
    request: ChatCompletionRequest,
    data: unknown,
    startedAt: number,
  ): ChatCompletionResult {
    const root = isRecord(data) ? data : {};
    const choices = asArray(root.choices);
    const choice = choices[0];
    if (!isRecord(choice)) {
      throw new Error("响应中没有 choices");
    }

    const message = isRecord(choice.message) ? choice.message : {};
    const finishReason = asString(choice.finish_reason) ?? "";
    const content = asString(message.content) ?? "";
    const reasoningContent = asString(message.reasoning_content);
    const toolCalls = parseToolCalls(message.tool_calls);
    const usage = parseUsage(root.usage);

    const metadata: MessageMetadata | undefined = usage
      ? { contextUsageRatio: usage.totalTokens / this.contextWindow(request.model) }
      : undefined;

    const aiMessage: AIMessage = {
      type: "ai",
      content,
      ...(reasoningContent !== undefined ? { reasoningContent } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(metadata ? { metadata } : {}),
    };

    return new ChatCompletionResult({
      request,
      aiMessage,
      finishReason,
      toolCalls,
      usage,
      elapsedMs: performance.now() - startedAt,
    });
  }

  private failed(
    request: ChatCompletionRequest,
    kind: ErrorKind,
    message: string,
    startedAt: number,
    statusCode?: number,
    cause?: unknown,
    details?: unknown,
  ): ChatCompletionResult {
    return new ChatCompletionResult({
      request,
      error: new ChatError(request.label, message, { kind, statusCode, cause, details }),
      elapsedMs: performance.now() - startedAt,
    });
  }
}

/** 全项目共用的默认 DeepSeek 服务实例：无状态，可被任意系统/任务复用。 */
export const DEEPSEEK_SERVICE = new DeepSeekClient();
