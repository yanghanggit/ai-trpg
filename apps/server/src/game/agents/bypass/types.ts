import type { TraceContext } from "../../../debug/trace";
import type { agentLoop } from "../../../llm/agent-loop";
import type { ChatCompletionService } from "../../../llm/protocol";
import type { ToolDefinition } from "../../../llm/types";

/**
 * 旁路推理的依赖：服务、日志与所属回合的轨迹。
 *
 * 不含轮数预算：预算是各次任务自己的口径，由任务带。
 */
export type MemoryRenderOptions = {
  service: ChatCompletionService;
  logger?: Parameters<typeof agentLoop>[0]["logger"];
  /** 所属回合的轨迹；有值则把这次推理并入该回合。 */
  trace?: TraceContext;
};

/**
 * 一次旁路推理要做什么：本轮看什么、用哪个终止工具、提交怎么校验。
 *
 * 协议文本（重复提交、没提交）按 `label` 统一拼，调用方只给中文名。
 */
export type MemoryRenderTask<T> = {
  inputMessage: string;
  maxRounds: number;
  /** 这一轮唯一的终止工具。 */
  tool: ToolDefinition;
  /** 工具参数的校验与转换；不合法就抛 `GameError`。 */
  parse: (args: Record<string, unknown>) => T;
  /** 中文名，用于失败原因与工具回执。 */
  label: string;
};

/** 旁路的产出：提交的值，或没生成时的原因。 */
export type MemoryRenderResult<T> = {
  value: T | null;
  reason?: string;
};
