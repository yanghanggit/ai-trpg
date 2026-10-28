/**
 * 图像生成服务：provider 预测 → 下载产物 → 写 raw + meta。
 *
 * 无状态，可并发复用。失败策略与 `llm` 层一致：传输层的预期内失败抛
 * `ImageGenError`（带 kind / retryable），批量入口再把单项失败隔离成结果。
 * 这里不碰数据库、不接游戏业务，也不提供 HTTP 路由。
 */

import { type Logger, silentLogger } from "../logging";
import {
  defaultImagesDir,
  downloadImage,
  ImageAssetStore,
  type ImageMeta,
  newImageFilename,
  normalizeImageFormat,
} from "./assets";
import {
  type BatchGenerateImagesOptions,
  batchGenerateImages,
  type ImageBatchResult,
} from "./batch";
import { ImageGenError } from "./errors";
import {
  type FetchLike,
  type ImageGenerationRequest,
  type ImageModelInfo,
  type ImageProvider,
  imageGenerationRequestSchema,
  type ProviderStatus,
} from "./types";

export type GeneratedImage = {
  meta: ImageMeta;
  path: string;
  metaPath: string;
};

export type TextToImageInput = Omit<ImageGenerationRequest, "inputImages">;

export type EditImageInput = ImageGenerationRequest & {
  inputImages: readonly [string, ...string[]];
};

export type ImageGenerationServiceOptions = {
  provider: ImageProvider;
  store?: ImageAssetStore;
  /** 测试注入点；只影响产物下载。 */
  fetch?: FetchLike;
  logger?: Logger;
  maxDownloadBytes?: number;
  downloadTimeoutMs?: number;
};

function resolvedNumber(
  input: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function resolvedString(input: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}

export class ImageGenerationService {
  readonly provider: ImageProvider;
  readonly store: ImageAssetStore;

  private readonly fetchImpl: FetchLike | undefined;
  private readonly logger: Logger;
  private readonly maxDownloadBytes: number | undefined;
  private readonly downloadTimeoutMs: number | undefined;

  constructor(options: ImageGenerationServiceOptions) {
    this.provider = options.provider;
    this.logger = options.logger ?? silentLogger;
    this.store =
      options.store ?? new ImageAssetStore({ dir: defaultImagesDir(), logger: this.logger });
    this.fetchImpl = options.fetch;
    this.maxDownloadBytes = options.maxDownloadBytes;
    this.downloadTimeoutMs = options.downloadTimeoutMs;
  }

  listModels(): readonly ImageModelInfo[] {
    return this.provider.listModels();
  }

  checkConnection(): Promise<ProviderStatus> {
    return this.provider.checkConnection();
  }

  listImages(): ReturnType<ImageAssetStore["list"]> {
    return this.store.list();
  }

  readImage(filename: string): ReturnType<ImageAssetStore["readMeta"]> {
    return this.store.readMeta(filename);
  }

  /** 通用入口：带 inputImages 即图生图。 */
  async generate(request: ImageGenerationRequest): Promise<GeneratedImage> {
    const parsed = imageGenerationRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ImageGenError("imagegen", "生成请求校验失败", {
        kind: "validation",
        details: parsed.error.issues,
      });
    }
    const input = parsed.data;
    const isEdit = (input.inputImages?.length ?? 0) > 0;
    if (!this.provider.supports(input.model)) {
      throw new ImageGenError("imagegen", `不支持的模型: ${input.model}`, {
        kind: "validation",
      });
    }

    this.logger.info(
      `开始生成图片: model=${input.model} source=${isEdit ? "image_edit" : "text2image"}`,
    );
    const generation = await this.provider.generate(input);
    const outputUrl = generation.outputUrls[0];
    if (!outputUrl) {
      throw new ImageGenError("imagegen", "provider 没有返回图片 URL", { kind: "model" });
    }

    const resolvedFormat = normalizeImageFormat(
      resolvedString(generation.resolvedInput, ["output_format"]),
    );
    const fallbackFormat = input.outputFormat ?? resolvedFormat ?? "png";
    const downloaded = await downloadImage(outputUrl, {
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
      ...(this.maxDownloadBytes !== undefined ? { maxBytes: this.maxDownloadBytes } : {}),
      ...(this.downloadTimeoutMs !== undefined ? { timeoutMs: this.downloadTimeoutMs } : {}),
      fallbackFormat,
    });

    const filename = newImageFilename(downloaded.format);
    const meta = {
      schemaVersion: 1 as const,
      type: "image" as const,
      filename,
      provider: this.provider.id,
      model: generation.model,
      modelRef: generation.modelRef,
      source: isEdit ? ("image_edit" as const) : ("text2image" as const),
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? "",
      aspectRatio: resolvedString(generation.resolvedInput, ["aspect_ratio"]),
      width: resolvedNumber(generation.resolvedInput, ["width"]) ?? 0,
      height: resolvedNumber(generation.resolvedInput, ["height"]) ?? 0,
      seed: resolvedNumber(generation.resolvedInput, ["seed"]),
      steps: resolvedNumber(generation.resolvedInput, ["num_inference_steps"]),
      guidance: resolvedNumber(generation.resolvedInput, ["guidance_scale"]),
      format: downloaded.format,
      inputImages: [...(input.inputImages ?? [])],
      providerOptions: { ...(input.providerOptions ?? {}) },
      sizeBytes: downloaded.bytes.length,
      predictionId: generation.predictionId,
      elapsedMs: generation.elapsedMs,
      createdAt: new Date().toISOString(),
    };
    const saved = await this.store.save(meta, downloaded.bytes);

    this.logger.info(
      `图片资产已保存: ${saved.path} (${downloaded.bytes.length} bytes, ${downloaded.format})`,
    );
    return { meta, path: saved.path, metaPath: saved.metaPath };
  }

  generateText(input: TextToImageInput): Promise<GeneratedImage> {
    return this.generate({ ...input, inputImages: undefined });
  }

  async edit(input: EditImageInput): Promise<GeneratedImage> {
    if (input.inputImages.length === 0) {
      throw new ImageGenError("imagegen", "图生图至少需要一张输入图片", {
        kind: "validation",
      });
    }
    return this.generate(input);
  }

  batch(
    requests: readonly ImageGenerationRequest[],
    options: BatchGenerateImagesOptions = {},
  ): Promise<ImageBatchResult[]> {
    return batchGenerateImages(this, requests, options);
  }
}
