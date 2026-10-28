/**
 * 图像生成基建的公共数据类型（provider 无关）。
 *
 * 这一层只说「要生成什么 / 生成了什么 / 模型能做什么」，不出现任何厂商
 * 的模型 slug、接口地址或鉴权方式；厂商细节全部收在 `providers/` 适配器里。
 */

import { z } from "zod";

/** 测试注入点；默认使用 Node 22 的全局 fetch。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 资产生成方式：文生图 / 图生图。 */
export const imageSourceSchema = z.enum(["text2image", "image_edit"]);
export type ImageSource = z.infer<typeof imageSourceSchema>;

/** 可控的输出格式；实际落盘格式以下载响应为准。 */
export const imageOutputFormatSchema = z.enum(["png", "jpg", "webp"]);
export type ImageOutputFormat = z.infer<typeof imageOutputFormatSchema>;

/**
 * 一次生成请求。所有模型共用这套字段，由 provider 按模型能力裁剪；
 * 模型不支持的字段会被明确拒绝，而不是静默丢弃。
 */
export const imageGenerationRequestSchema = z
  .object({
    model: z.string().min(1),
    prompt: z.string().trim().min(1, "prompt 不能为空"),
    negativePrompt: z.string().optional(),
    /** 只用于推导宽高比；模型若直接支持宽高则原样下发。 */
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    aspectRatio: z.string().min(1).optional(),
    /** 图生图输入：本地路径、HTTP(S) URL 或 data URL。 */
    inputImages: z.array(z.string().min(1)).optional(),
    outputFormat: imageOutputFormatSchema.optional(),
    seed: z.number().int().optional(),
    steps: z.number().int().positive().optional(),
    guidance: z.number().nonnegative().optional(),
    /** 厂商专属开关，键名由 provider 白名单校验。 */
    providerOptions: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();
export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;

/** 模型能力：由 provider 声明，CLI 与调用方据此展示与校验。 */
export type ImageModelCapabilities = {
  sources: readonly ImageSource[];
  aspectRatios: readonly string[];
  outputFormats: readonly ImageOutputFormat[];
};

export type ImageModelInfo = {
  id: string;
  label: string;
  /** provider 稳定标识；领域层只把它当数据，不据此分支。 */
  provider: string;
  capabilities: ImageModelCapabilities;
};

/** provider 完成一次预测后的归一化结果。 */
export type ProviderGeneration = {
  predictionId: string;
  model: string;
  modelRef: string;
  outputUrls: readonly string[];
  /** 已脱敏的实际模型输入：文件输入替换为占位符，可安全写入 meta。 */
  resolvedInput: Readonly<Record<string, unknown>>;
  logs: string;
  metrics: Readonly<Record<string, number>>;
  elapsedMs: number;
};

export type ProviderStatus = {
  ok: true;
  latencyMs: number;
  detail: string;
};

/** 厂商适配器必须实现的接口；领域层只依赖它。 */
export interface ImageProvider {
  readonly id: string;
  listModels(): readonly ImageModelInfo[];
  supports(model: string): boolean;
  generate(
    request: ImageGenerationRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ProviderGeneration>;
  checkConnection(): Promise<ProviderStatus>;
}
