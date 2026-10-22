/**
 * DeepSeek 绑定入口：把 `llm.agentLoop` 绑定到默认的 `DEEPSEEK_SERVICE`。
 *
 * 编排逻辑在 `llm/agent-loop.ts`（provider 无关）；「用哪个 provider」只在这里
 * 决定一次。测试可以通过 `service` 注入替身，避免真的发 HTTP。
 */

import {
  type AgentLoopOptions,
  AgentLoopResult,
  type AgentLoopRound,
  agentLoop as runAgentLoop,
} from "../llm/agent-loop";
import type { ChatCompletionService } from "../llm/protocol";
import { DEEPSEEK_SERVICE } from "./client";

export type DeepSeekAgentLoopOptions = Omit<AgentLoopOptions, "service"> & {
  service?: ChatCompletionService;
};

export { AgentLoopResult, type AgentLoopRound };

export async function agentLoop(options: DeepSeekAgentLoopOptions): Promise<AgentLoopResult> {
  const { service = DEEPSEEK_SERVICE, ...loopOptions } = options;
  return runAgentLoop({ ...loopOptions, service });
}
