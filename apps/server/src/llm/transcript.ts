/**
 * transcript：把一次 chat completion 的请求 / 结果记录到 `logs/llm/`，
 * 供后续人工或 LLM 分析提示词、工具调用与上下文结构。
 *
 * 这是后验分析旁路，不属于请求主路径。写入要同时满足两级开关（AND）：
 *
 * 1. 请求级：`ChatCompletionRequest.dump`（默认 true）——「这次想不想留痕」；
 * 2. 进程级：环境变量 `LLM_DUMP_ENABLED`——「这台进程允不允许落盘」。
 *
 * 与 Python 版的差异：
 * - 进程级默认**关闭**，避免生产环境无意中把 prompt / 回复写满磁盘；
 * - 目录在写入时才创建，不在模块 import 时产生文件系统副作用。
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type LlmLogger, silentLogger } from "./logger";
import { getBufferString } from "./messages";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ToolCall,
  ToolDefinition,
  Usage,
} from "./types";

/** 默认存储目录（相对于服务进程的工作目录）。 */
export const LLM_DUMP_DIR = "logs/llm";
export const ENV_LLM_DUMP_SWITCH = "LLM_DUMP_ENABLED";

const SEP = "-".repeat(86);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);
const SAFE_FILENAME_PATTERN = /[^0-9A-Za-z_.\-\u4e00-\u9fff]/g;

let warnedEnvSuppressed = false;

export type TranscriptFormat = "text" | "jsonl" | "both";

export type TranscriptOptions = {
  dir?: string;
  /** 显式覆盖进程级开关；主要供测试使用。 */
  enabled?: boolean;
  /** 默认同时写可读文本与机器可读 JSONL。 */
  format?: TranscriptFormat;
  logger?: LlmLogger;
};

/** JSONL 单行结构：一轮请求 + 对应响应。 */
export type TranscriptRecord = {
  version: 1;
  timestamp: string;
  label: string;
  request: {
    label: string;
    inputMessage: string;
    model: string | null;
    thinking: boolean;
    toolChoice: string | null;
    reasoningEffort: string | null;
    temperature: number | null;
    maxTokens: number | null;
    tools: readonly ToolDefinition[];
    messages: readonly ChatMessage[];
  };
  response: {
    finishReason: string;
    content: string;
    reasoningContent: string | null;
    toolCalls: readonly ToolCall[];
    usage: Usage | null;
    elapsedMs: number;
    contextUsageRatio: number | null;
  };
};

/** 同一进程内串行追加，避免并发请求把 JSONL 行写花。 */
let jsonlAppendQueue: Promise<void> = Promise.resolve();

/** 进程级总开关；未设置或空值视为关闭。 */
export function envAllowsDump(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENV_LLM_DUMP_SWITCH];
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") {
    return false;
  }
  return !FALSE_VALUES.has(normalized);
}

function envExplicitlyDisallowsDump(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENV_LLM_DUMP_SWITCH];
  if (raw === undefined || raw.trim() === "") {
    return false;
  }
  return FALSE_VALUES.has(raw.trim().toLowerCase());
}

function warnEnvSuppressed(logger: LlmLogger): void {
  if (warnedEnvSuppressed) {
    return;
  }
  warnedEnvSuppressed = true;
  logger.warn(
    `transcript 已被环境变量 ${ENV_LLM_DUMP_SWITCH} 关闭；request.dump=true 被忽略（本进程仅提示一次）`,
  );
}

function timestamp(date = new Date()): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getMilliseconds(), 3)}`;
}

function safeLabel(label: string): string {
  return label.replace(SAFE_FILENAME_PATTERN, "_");
}

function dateStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function buildRecord(
  request: ChatCompletionRequest,
  completion: ChatCompletionResult,
  now: Date,
): TranscriptRecord {
  const ratio = completion.aiMessage?.metadata?.contextUsageRatio;
  return {
    version: 1,
    timestamp: now.toISOString(),
    label: request.label,
    request: {
      label: request.label,
      inputMessage: request.inputMessage,
      model: request.model ?? null,
      thinking: request.thinking,
      toolChoice: request.toolChoice ?? null,
      reasoningEffort: request.reasoningEffort ?? null,
      temperature: request.temperature ?? null,
      maxTokens: request.maxTokens ?? null,
      tools: request.tools,
      messages: request.messages,
    },
    response: {
      finishReason: completion.finishReason,
      content: completion.content,
      reasoningContent: completion.reasoningContent.length > 0 ? completion.reasoningContent : null,
      toolCalls: completion.toolCalls,
      usage: completion.usage ?? null,
      elapsedMs: completion.elapsedMs,
      contextUsageRatio: typeof ratio === "number" ? ratio : null,
    },
  };
}

function appendJsonl(file: string, line: string): Promise<void> {
  const next = jsonlAppendQueue.then(() => appendFile(file, line, "utf8"));
  // 链式队列吞掉错误，避免一次写失败让后续所有 append 都拒绝；调用方仍能拿到本次错误。
  jsonlAppendQueue = next.catch(() => undefined);
  return next;
}

/** 把「这次问了什么、答了什么」写入 `logs/llm/`（text / JSONL）。 */
export async function saveTranscript(
  request: ChatCompletionRequest,
  completion: ChatCompletionResult,
  options: TranscriptOptions = {},
): Promise<void> {
  if (!request.dump || !completion.ok) {
    return;
  }

  const logger = options.logger ?? silentLogger;
  const allowed = options.enabled ?? envAllowsDump();
  if (!allowed) {
    // 未设置视为默认关闭，不提示；只有显式配置为 false 时才提醒调用方。
    if (envExplicitlyDisallowsDump()) {
      warnEnvSuppressed(logger);
    }
    return;
  }

  try {
    const messages = [...request.messages];
    if (request.inputMessage.length > 0) {
      messages.push({ type: "human", content: request.inputMessage });
    }
    if (completion.aiMessage) {
      messages.push(completion.aiMessage);
    } else {
      messages.push({ type: "ai", content: completion.content });
    }

    const dir = options.dir ?? LLM_DUMP_DIR;
    await mkdir(dir, { recursive: true });
    const now = new Date();
    const format = options.format ?? "both";

    if (format === "text" || format === "both") {
      let content = getBufferString(messages, {
        systemPrefix: `\n${SEP}\nSystem`,
        humanPrefix: `\n${SEP}\nHuman`,
        aiPrefix: `\n${SEP}\nAI`,
        toolPrefix: `\n${SEP}\nTool`,
        renderToolCalls: true,
      });

      if (completion.reasoningContent.length > 0) {
        content += `\n${SEP}\n${completion.reasoningContent}`;
      }
      content += "\n";

      const file = join(dir, `${timestamp(now)}_${safeLabel(request.label)}.txt`);
      await writeFile(file, content, "utf8");
      logger.debug(`transcript text saved: ${file}`);
    }

    if (format === "jsonl" || format === "both") {
      const file = join(dir, `transcript-${dateStamp(now)}.jsonl`);
      const record = buildRecord(request, completion, now);
      await appendJsonl(file, `${JSON.stringify(record)}\n`);
      logger.debug(`transcript jsonl appended: ${file}`);
    }
  } catch (error) {
    logger.warn(
      `saveTranscript failed for '${request.label}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
