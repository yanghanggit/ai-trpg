/**
 * 批量（batch）并发 chat completion（provider 无关）。
 *
 * 入参是「一个无状态 service + 一批 completion 请求」，出参与请求**按顺序对齐**。
 * 结果自带 `error`，调用方不需要再拿 client 对象去对账。
 */

import { ChatError } from "./errors";
import { type LlmLogger, silentLogger } from "./logger";
import type { ChatCompletionService } from "./protocol";
import { type ChatCompletionRequest, ChatCompletionResult } from "./types";

export type BatchCompleteOptions = {
  /** 同时在飞的请求数上限，默认 2。 */
  maxConcurrency?: number;
  logger?: LlmLogger;
};

/** 结果与入参等长同序；意外异常也收敛成 `error`，不只覆盖预期内失败。 */
export async function batchComplete(
  service: ChatCompletionService,
  requests: readonly ChatCompletionRequest[],
  options: BatchCompleteOptions = {},
): Promise<ChatCompletionResult[]> {
  if (requests.length === 0) {
    return [];
  }

  const maxConcurrency = options.maxConcurrency ?? 2;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new RangeError("maxConcurrency 必须为 >= 1 的整数");
  }

  const logger = options.logger ?? silentLogger;
  const startedAt = performance.now();
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < maxConcurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    active += 1;
  }

  function release(): void {
    active -= 1;
    const next = waiters.shift();
    next?.();
  }

  async function guarded(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    await acquire();
    try {
      return await service.complete(request);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return new ChatCompletionResult({
        request,
        error: new ChatError(request.label, message, { kind: "api", cause: error }),
      });
    } finally {
      release();
    }
  }

  const results = await Promise.all(requests.map((request) => guarded(request)));
  const elapsedMs = performance.now() - startedAt;
  logger.debug(`batch_complete: ${requests.length} requests, ${elapsedMs.toFixed(2)}ms`);

  const failed = results.filter((result) => !result.ok).map((result) => result.label);
  if (failed.length > 0) {
    logger.warn(`batch_complete: ${failed.length}/${requests.length} failed: ${failed.join(", ")}`);
  }

  return results;
}
