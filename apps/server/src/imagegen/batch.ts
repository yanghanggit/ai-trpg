/**
 * 批量图像生成：结果与请求等长同序，单项失败不影响其它项。
 *
 * 与 `llm/batch.ts` 同一套并发模型：同时在飞的请求数由信号量限制，
 * 意外异常也收敛到结果对象里，调用方不需要自己兜异常。
 */

import type { ImageLogger } from "./logger";
import { silentLogger } from "./logger";
import type { ImageGenerationService } from "./service";
import type { ImageGenerationRequest } from "./types";

export type ImageBatchSuccess = {
  index: number;
  ok: true;
  image: Awaited<ReturnType<ImageGenerationService["generate"]>>;
};

export type ImageBatchFailure = {
  index: number;
  ok: false;
  error: string;
};

export type ImageBatchResult = ImageBatchSuccess | ImageBatchFailure;

export type BatchGenerateImagesOptions = {
  /** 同时在飞的请求数上限，默认 2。 */
  maxConcurrency?: number;
  logger?: ImageLogger;
};

export async function batchGenerateImages(
  service: ImageGenerationService,
  requests: readonly ImageGenerationRequest[],
  options: BatchGenerateImagesOptions = {},
): Promise<ImageBatchResult[]> {
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
    waiters.shift()?.();
  }

  async function guarded(
    index: number,
    request: ImageGenerationRequest,
  ): Promise<ImageBatchResult> {
    await acquire();
    try {
      return { index, ok: true, image: await service.generate(request) };
    } catch (error) {
      return {
        index,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      release();
    }
  }

  const results = await Promise.all(requests.map((request, index) => guarded(index, request)));
  const elapsedMs = performance.now() - startedAt;
  const failed = results.filter((result) => !result.ok).length;

  if (failed > 0) {
    logger.warn(
      `batch_generate_images: ${failed}/${requests.length} 失败, ${elapsedMs.toFixed(0)}ms`,
    );
  } else {
    logger.info(
      `batch_generate_images: ${requests.length}/${requests.length} 成功, ${elapsedMs.toFixed(0)}ms`,
    );
  }

  return results;
}
