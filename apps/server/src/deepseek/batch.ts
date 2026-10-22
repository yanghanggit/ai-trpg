/**
 * DeepSeek 绑定入口：把 `llm.batchComplete` 绑定到默认的 `DEEPSEEK_SERVICE`。
 *
 * 编排在抽象层，provider 选择只在本包决定一次；业务侧不需要自己持有 service。
 */

import { type BatchCompleteOptions, batchComplete as batchCompleteWithService } from "../llm/batch";
import type { ChatCompletionService } from "../llm/protocol";
import type { ChatCompletionRequest, ChatCompletionResult } from "../llm/types";
import { DEEPSEEK_SERVICE } from "./client";

export type DeepSeekBatchOptions = BatchCompleteOptions & {
  /** 默认使用 `DEEPSEEK_SERVICE`；测试可注入替身。 */
  service?: ChatCompletionService;
};

export async function batchComplete(
  requests: readonly ChatCompletionRequest[],
  options: DeepSeekBatchOptions = {},
): Promise<ChatCompletionResult[]> {
  const { service = DEEPSEEK_SERVICE, ...batchOptions } = options;
  return batchCompleteWithService(service, requests, batchOptions);
}
