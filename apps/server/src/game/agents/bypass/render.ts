import { randomUUID } from "node:crypto";
import { DEFAULT_ERROR_RETRIES, loopErrorReason } from "../../../llm";
import { agentLoop } from "../../../llm/agent-loop";
import { GameError } from "../../errors";
import type { MemoryTarget } from "./target";
import type { MemoryRenderOptions, MemoryRenderResult, MemoryRenderTask } from "./types";

/**
 * 一次旁路推理：借当事人的记忆跑一轮，只认一个终止工具。
 *
 * 记忆原样带走——system prompt 就是它的宪法，所以这里不再携带任何设定。
 * `mutateMessages: false`：这一轮的推理轮次与工具调用都留在副本里，不进 memory。
 * 产物怎么落账不在这里：本函数只把提交的值交回调用方。
 */
export async function renderWithMemory<T>(
  target: MemoryTarget,
  task: MemoryRenderTask<T>,
  options: MemoryRenderOptions,
): Promise<MemoryRenderResult<T>> {
  let submitted: T | null = null;

  const loop = await agentLoop({
    name: target.actor.name,
    inputMessage: task.inputMessage,
    messages: target.memory.messages,
    mutateMessages: false,
    tools: [task.tool],
    handlers: {
      [task.tool.function.name]: (args) => {
        if (submitted !== null) {
          throw new GameError("invalid_action", `${task.label}已提交`);
        }
        submitted = task.parse(args);
        return `${task.label}已提交`;
      },
    },
    terminalTools: [task.tool],
    service: options.service,
    maxRounds: task.maxRounds,
    errorRetries: DEFAULT_ERROR_RETRIES,
    loopId: randomUUID(),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });

  if (!loop.success) {
    return { value: null, reason: loopErrorReason(loop) ?? "推理未完成" };
  }
  return submitted === null
    ? { value: null, reason: `模型未调用 ${task.tool.function.name} 提交${task.label}` }
    : { value: submitted };
}
