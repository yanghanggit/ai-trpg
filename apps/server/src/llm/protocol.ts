/**
 * 与具体 provider 无关的 chat completion 服务契约。
 *
 * 依赖方向：`llm.agent-loop` / `llm.batch` -> `llm.protocol` <- `deepseek.client`。
 * 抽象层不得 import `deepseek`；实现方也不需要显式继承，靠结构匹配即可。
 */

import type { ChatCompletionRequest, ChatCompletionResult } from "./types";

export interface ChatCompletionService {
  /**
   * 请求模型补全下一条 assistant 消息。
   *
   * 约定：预期内的通讯失败（超时 / 连接 / 非 200）不抛异常，而是填进
   * `ChatCompletionResult.error`；真正的程序错误与取消仍然抛出。
   */
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
}
