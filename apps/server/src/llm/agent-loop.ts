/**
 * 通用 agentic 循环（provider 无关）。
 *
 * 驱动 LLM 与工具交互，直到 LLM 主动 stop、调用 terminalTools 中任一工具，
 * 或达到最大轮次。循环只依赖 `ChatCompletionService`，provider 由调用方注入。
 */

import { type TraceContext, traceEvent } from "../debug/trace";
import { type Logger, silentLogger } from "../logging";
import type { ChatCompletionService } from "./protocol";
import {
  ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  type HumanMessage,
  isHumanMessage,
  type MessageMetadata,
  type ToolChoice,
  type ToolDefinition,
} from "./types";

/** loop 边界标记：起点 HumanMessage 带 loopId，本次 loop 最后一条消息带 loopIdEnd。 */
export const LOOP_ID_ATTR = "loopId";
export const LOOP_END_ATTR = "loopIdEnd";

/** 上下文占用比例由 provider 写在 AI 消息的 metadata 上；没有就记 null。 */
function contextUsageRatioOf(completion: ChatCompletionResult): number | null {
  const ratio = completion.aiMessage?.metadata?.contextUsageRatio;
  return typeof ratio === "number" ? ratio : null;
}

export type ToolHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export type AgentLoopOptions = {
  name: string;
  inputMessage: string;
  /** 有状态的消息历史；默认原地追加。 */
  messages: ChatMessage[];
  tools: readonly ToolDefinition[];
  handlers: Readonly<Record<string, ToolHandler>>;
  service: ChatCompletionService;
  mutateMessages?: boolean;
  maxRounds?: number;
  maxTerminalNudges?: number;
  toolChoice?: ToolChoice;
  thinking?: boolean;
  terminalTools?: readonly ToolDefinition[];
  inputMetadata?: Readonly<MessageMetadata>;
  loopId?: string;
  logger?: Logger;
  /** 回合轨迹；有值则每次 LLM 调用落一条 llm_call / llm_result。 */
  trace?: TraceContext;
};

export type AgentLoopRound = {
  completion: ChatCompletionResult;
  appended: ChatMessage[];
};

export class AgentLoopResult {
  readonly success: boolean;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly messages: ChatMessage[];
  readonly rounds: AgentLoopRound[];
  readonly startMessage: HumanMessage | undefined;

  constructor(init: {
    success: boolean;
    startIndex: number;
    endIndex: number;
    messages: ChatMessage[];
    rounds: AgentLoopRound[];
    startMessage?: HumanMessage;
  }) {
    this.success = init.success;
    this.startIndex = init.startIndex;
    this.endIndex = init.endIndex;
    this.messages = init.messages;
    this.rounds = init.rounds;
    this.startMessage = init.startMessage;
  }

  get ok(): boolean {
    return this.success;
  }

  toBoolean(): boolean {
    return this.success;
  }
}

class LoopSpanTracker {
  readonly startIndex: number;
  readonly rounds: AgentLoopRound[] = [];
  private readonly history: ChatMessage[];
  private readonly loopId: string | undefined;
  private startMarked = false;

  constructor(history: ChatMessage[], loopId: string | undefined) {
    this.history = history;
    this.loopId = loopId;
    this.startIndex = history.length;
  }

  appendStartMessage(content: string, metadataInput: Readonly<MessageMetadata> | undefined): void {
    const metadata: MessageMetadata = { ...metadataInput };
    if (this.loopId !== undefined) {
      metadata[LOOP_ID_ATTR] = this.loopId;
      this.startMarked = true;
    }
    this.history.push({ type: "human", content, metadata });
  }

  recordRound(completion: ChatCompletionResult, roundStart: number): void {
    this.rounds.push({
      completion,
      appended: this.history.slice(roundStart),
    });
  }

  markEnd(): void {
    if (this.loopId === undefined || !this.startMarked || this.history.length <= this.startIndex) {
      return;
    }
    const last = this.history.at(-1);
    if (last) {
      last.metadata = { ...last.metadata, [LOOP_END_ATTR]: this.loopId };
    }
  }

  buildResult(success: boolean): AgentLoopResult {
    this.markEnd();
    const candidate = this.history[this.startIndex];
    return new AgentLoopResult({
      success,
      startIndex: this.startIndex,
      endIndex: this.history.length,
      messages: this.history,
      rounds: this.rounds,
      startMessage: candidate && isHumanMessage(candidate) ? candidate : undefined,
    });
  }
}

function buildTerminalNudge(terminalTools: readonly ToolDefinition[]): string {
  const names = terminalTools.map((tool) => tool.function.name).join("、");
  return `你尚未调用要求的终止工具（${names}）就结束了回复。请勿以普通文本直接作答，必须通过工具调用提交最终结果；如仍需读取或写入数据，请先完成相应工具调用，最后再调用终止工具提交。`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("工具参数必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

/**
 * 通用 agentic 循环。
 *
 * 当声明了 terminalTools 时，`finishReason === "stop"` 不再等同于正常结束：
 * 若尚未成功调用任一终止工具，则注入纠偏提示后强制重试（最多 maxTerminalNudges 次）。
 */
export async function agentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    name,
    inputMessage,
    messages,
    tools,
    handlers,
    service,
    mutateMessages = true,
    maxRounds = 5,
    maxTerminalNudges = 2,
    toolChoice = "auto",
    thinking = false,
    terminalTools = [],
    inputMetadata,
    loopId,
    logger = silentLogger,
    trace,
  } = options;

  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new RangeError("maxRounds 必须为 >= 1 的整数");
  }
  if (!Number.isInteger(maxTerminalNudges) || maxTerminalNudges < 0) {
    throw new RangeError("maxTerminalNudges 必须为 >= 0 的整数");
  }

  const history: ChatMessage[] = mutateMessages ? messages : [...messages];
  let currentPrompt = inputMessage;
  const terminalToolNames = new Set(terminalTools.map((tool) => tool.function.name));
  let nudgeCount = 0;
  const tracker = new LoopSpanTracker(history, loopId);

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      logger.debug(`[agent_loop:${name}] 第 ${round}/${maxRounds} 轮`);
      const roundStart = history.length;

      const request = new ChatCompletionRequest({
        label: name,
        inputMessage: currentPrompt,
        messages: history,
        tools,
        toolChoice: nudgeCount > 0 ? "required" : toolChoice,
        thinking,
      });

      await traceEvent(trace, {
        event: "llm_call",
        round,
        ...(loopId === undefined ? {} : { loopId }),
        label: name,
        settings: {
          model: request.model ?? null,
          thinking: request.thinking,
          toolChoice: request.toolChoice ?? "auto",
          reasoningEffort: request.reasoningEffort ?? null,
          temperature: request.temperature ?? null,
          maxTokens: request.maxTokens ?? null,
        },
        tools: request.tools,
        inputMessage: currentPrompt,
        messages: history,
      });

      const completion = await service.complete(request);

      await traceEvent(trace, {
        event: "llm_result",
        round,
        ...(loopId === undefined ? {} : { loopId }),
        label: name,
        finishReason: completion.finishReason,
        content: completion.content,
        contextUsageRatio: contextUsageRatioOf(completion),
        elapsedMs: completion.elapsedMs,
        usage: completion.usage,
        ...(completion.error
          ? {
              error: {
                kind: completion.error.kind,
                message: completion.error.message,
                retryable: completion.error.retryable,
              },
            }
          : {
              reasoningContent: completion.reasoningContent,
              toolCalls: completion.toolCalls,
            }),
      });

      if (completion.error) {
        logger.error(
          `[agent_loop:${name}] LLM 请求失败，第 ${round} 轮，中止本轮: ${completion.error.message}`,
        );
        tracker.recordRound(completion, roundStart);
        continue;
      }

      if (currentPrompt.length > 0) {
        tracker.appendStartMessage(currentPrompt, inputMetadata);
        currentPrompt = "";
      }

      const aiMessage = completion.aiMessage;
      if (!aiMessage) {
        logger.error(`[agent_loop:${name}] LLM 回复消息为空，中止`);
        tracker.recordRound(completion, roundStart);
        return tracker.buildResult(false);
      }

      history.push(aiMessage);

      if (completion.finishReason === "stop") {
        if (terminalToolNames.size === 0) {
          logger.debug(`[agent_loop:${name}] LLM stop，第 ${round} 轮`);
          tracker.recordRound(completion, roundStart);
          return tracker.buildResult(true);
        }

        nudgeCount += 1;
        if (nudgeCount > maxTerminalNudges) {
          logger.error(
            `[agent_loop:${name}] LLM 连续 ${maxTerminalNudges} 次未调用终止工具即停止，中止`,
          );
          tracker.recordRound(completion, roundStart);
          return tracker.buildResult(false);
        }

        logger.warn(
          `[agent_loop:${name}] LLM 未调用终止工具即 stop，注入纠偏提示重试（第 ${nudgeCount}/${maxTerminalNudges} 次）`,
        );
        history.push({ type: "human", content: buildTerminalNudge(terminalTools) });
        tracker.recordRound(completion, roundStart);
        continue;
      }

      if (completion.finishReason !== "tool_calls" || completion.toolCalls.length === 0) {
        logger.error(
          `[agent_loop:${name}] 意外的 finishReason=${JSON.stringify(completion.finishReason)}，中止`,
        );
        tracker.recordRound(completion, roundStart);
        return tracker.buildResult(false);
      }

      let terminalSeen = false;
      let terminalName: string | undefined;

      for (const toolCall of completion.toolCalls) {
        const handler = handlers[toolCall.function.name];
        let toolOutput: string;
        let succeeded = false;

        if (!handler) {
          logger.warn(`[agent_loop:${name}] 未知工具: ${JSON.stringify(toolCall.function.name)}`);
          toolOutput = `错误：未知工具 ${JSON.stringify(toolCall.function.name)}`;
        } else {
          try {
            const args = parseToolArguments(toolCall.function.arguments);
            const rawResult = await handler(args);
            toolOutput = rawResult === undefined || rawResult === null ? "" : String(rawResult);
            succeeded = true;
          } catch (error) {
            logger.error(
              `[agent_loop:${name}] 工具 ${JSON.stringify(toolCall.function.name)} 执行失败: ${errorMessage(error)}\n  raw arguments: ${JSON.stringify(toolCall.function.arguments)}`,
            );
            toolOutput = `错误：工具执行失败 ${errorMessage(error)}`;
          }
        }

        history.push({ type: "tool", content: toolOutput, toolCallId: toolCall.id });

        if (succeeded && terminalToolNames.has(toolCall.function.name)) {
          terminalSeen = true;
          terminalName = toolCall.function.name;
        }
      }

      tracker.recordRound(completion, roundStart);

      if (terminalSeen) {
        logger.debug(
          `[agent_loop:${name}] 终止工具 ${JSON.stringify(terminalName)} 已执行，结束循环`,
        );
        return tracker.buildResult(true);
      }
    }

    logger.error(`[agent_loop:${name}] 达到最大轮次限制 ${maxRounds}，中止`);
    return tracker.buildResult(false);
  } finally {
    // 异常 / 取消路径也补打终点标记，避免留下悬空起点。
    tracker.markEnd();
  }
}
