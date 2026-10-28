/**
 * Hosted 图像模型 provider 适配器（唯一的厂商实现）。
 *
 * 厂商名只在这里作为专有名词出现：领域层通过 `ImageProvider` 接口调用，
 * 不 import 本文件，也不根据厂商名分支。模型 slug、接口路径、鉴权 header、
 * 轮询协议都属于本层私有事实。
 *
 * 请求策略：先发同步预测（`Prefer: wait`），未完成再按 `urls.get` 轮询；
 * 预测失败、HTTP 错误、超时都收敛成 `ImageGenError`，由调用方决定是否重试。
 */

import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type Logger, silentLogger } from "../../logging";
import { findRepoRoot } from "../../paths";
import { ImageGenError } from "../errors";
import {
  type FetchLike,
  type ImageGenerationRequest,
  type ImageModelInfo,
  type ImageOutputFormat,
  type ImageProvider,
  type ImageSource,
  imageGenerationRequestSchema,
  type ProviderGeneration,
  type ProviderStatus,
} from "../types";

export const PROVIDER_ID = "replicate";
export const DEFAULT_MODEL = "nano-banana";
export const API_TOKEN_ENV = "REPLICATE_API_TOKEN";

const DEFAULT_BASE_URL = "https://api.replicate.com";
const DEFAULT_WAIT_SECONDS = 1;
const DEFAULT_CANCEL_AFTER_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
const MAX_INPUT_FILE_BYTES = 20 * 1024 * 1024;

const INPUT_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const RESERVED_INPUT_KEYS = new Set([
  "prompt",
  "negative_prompt",
  "aspect_ratio",
  "width",
  "height",
  "seed",
  "num_inference_steps",
  "guidance_scale",
  "output_format",
  "num_outputs",
  "image_input",
  "image",
]);

type ImageInputMode = "single" | "multiple";

type ModelSpec = {
  id: string;
  label: string;
  ref: string;
  sources: readonly ImageSource[];
  aspectRatios: readonly string[];
  defaultTextAspectRatio: string;
  defaultEditAspectRatio?: string;
  outputFormats: readonly ImageOutputFormat[];
  outputFormatKey?: string;
  defaultOutputFormat?: ImageOutputFormat;
  negativePromptKey?: string;
  stepsKey?: string;
  guidanceKey?: string;
  seedKey?: string;
  widthKey?: string;
  heightKey?: string;
  imageInputsKey?: string;
  imageInputsMode?: ImageInputMode;
  extraInputs?: readonly string[];
  fixedInputs?: Readonly<Record<string, string | number | boolean>>;
};

const MODELS: readonly ModelSpec[] = [
  {
    id: "nano-banana",
    label: "Gemini 2.5 Flash Image",
    ref: "google/nano-banana",
    sources: ["text2image", "image_edit"],
    aspectRatios: [
      "match_input_image",
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ],
    defaultTextAspectRatio: "1:1",
    defaultEditAspectRatio: "match_input_image",
    outputFormats: ["png", "jpg"],
    outputFormatKey: "output_format",
    defaultOutputFormat: "png",
    imageInputsKey: "image_input",
    imageInputsMode: "multiple",
  },
  {
    id: "nano-banana-pro",
    label: "Gemini 3 Pro Image",
    ref: "google/nano-banana-pro",
    sources: ["text2image", "image_edit"],
    aspectRatios: [
      "match_input_image",
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ],
    defaultTextAspectRatio: "1:1",
    defaultEditAspectRatio: "match_input_image",
    outputFormats: ["png", "jpg"],
    outputFormatKey: "output_format",
    defaultOutputFormat: "png",
    imageInputsKey: "image_input",
    imageInputsMode: "multiple",
    extraInputs: ["resolution", "safety_filter_level"],
  },
  {
    id: "flux-schnell",
    label: "FLUX.1 Schnell",
    ref: "black-forest-labs/flux-schnell",
    sources: ["text2image"],
    aspectRatios: ["1:1", "16:9", "21:9", "3:2", "2:3", "4:5", "5:4", "3:4", "4:3", "9:16", "9:21"],
    defaultTextAspectRatio: "1:1",
    outputFormats: ["png", "jpg", "webp"],
    outputFormatKey: "output_format",
    defaultOutputFormat: "png",
    stepsKey: "num_inference_steps",
    seedKey: "seed",
    extraInputs: ["output_quality", "megapixels", "go_fast", "disable_safety_checker"],
    fixedInputs: { num_outputs: 1 },
  },
  {
    id: "ideogram-v3-turbo",
    label: "Ideogram v3 Turbo",
    ref: "ideogram-ai/ideogram-v3-turbo",
    sources: ["text2image"],
    aspectRatios: [
      "1:3",
      "3:1",
      "1:2",
      "2:1",
      "9:16",
      "16:9",
      "10:16",
      "16:10",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "1:1",
    ],
    defaultTextAspectRatio: "1:1",
    outputFormats: [],
    seedKey: "seed",
    extraInputs: ["resolution", "magic_prompt_option", "style_type", "style_preset"],
  },
  {
    id: "stable-diffusion-3.5-large",
    label: "Stable Diffusion 3.5 Large",
    ref: "stability-ai/stable-diffusion-3.5-large",
    sources: ["text2image", "image_edit"],
    aspectRatios: ["16:9", "1:1", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"],
    defaultTextAspectRatio: "1:1",
    defaultEditAspectRatio: "1:1",
    outputFormats: ["png", "jpg", "webp"],
    outputFormatKey: "output_format",
    defaultOutputFormat: "png",
    negativePromptKey: "negative_prompt",
    seedKey: "seed",
    imageInputsKey: "image",
    imageInputsMode: "single",
    extraInputs: ["cfg", "prompt_strength"],
  },
];

const MODELS_BY_ID = new Map(MODELS.map((model) => [model.id, model]));

function getSpec(modelId: string): ModelSpec {
  const spec = MODELS_BY_ID.get(modelId);
  if (!spec) {
    throw new ImageGenError(
      "provider",
      `不支持的模型: ${modelId}（可用: ${MODELS.map((model) => model.id).join(", ")}）`,
      { kind: "validation" },
    );
  }
  return spec;
}

function modelInfo(spec: ModelSpec): ImageModelInfo {
  return {
    id: spec.id,
    label: spec.label,
    provider: PROVIDER_ID,
    capabilities: {
      sources: spec.sources,
      aspectRatios: spec.aspectRatios,
      outputFormats: spec.outputFormats,
    },
  };
}

function nearestAspectRatio(
  width: number,
  height: number,
  ratios: readonly string[],
): string | undefined {
  const candidates = ratios
    .filter((ratio) => ratio !== "match_input_image")
    .map((ratio) => {
      const [w = 0, h = 0] = ratio.split(":").map(Number);
      return { ratio, value: w / h };
    })
    .filter((candidate) => Number.isFinite(candidate.value) && candidate.value > 0);
  if (candidates.length === 0) {
    return undefined;
  }
  const target = width / height;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate.value - target) < Math.abs(best.value - target) ? candidate : best,
  ).ratio;
}

function resolveAspectRatio(
  spec: ModelSpec,
  request: ImageGenerationRequest,
  isEdit: boolean,
): string | undefined {
  const allowed = spec.aspectRatios.filter((ratio) => isEdit || ratio !== "match_input_image");
  if (allowed.length === 0) {
    return undefined;
  }

  const requested =
    request.aspectRatio ??
    (request.width !== undefined && request.height !== undefined
      ? nearestAspectRatio(request.width, request.height, allowed)
      : undefined);
  const fallback = isEdit
    ? (spec.defaultEditAspectRatio ?? spec.defaultTextAspectRatio)
    : spec.defaultTextAspectRatio;
  const ratio = requested ?? fallback;

  if (!allowed.includes(ratio)) {
    throw new ImageGenError(
      "provider",
      `模型 ${spec.id} 不支持宽高比 ${ratio}（可用: ${allowed.join(", ")}）`,
      { kind: "validation" },
    );
  }
  return ratio;
}

function absoluteInputPath(reference: string): string {
  if (isAbsolute(reference)) {
    return reference;
  }
  return resolve(findRepoRoot(), reference);
}

async function inputReferenceToUrl(reference: string): Promise<string> {
  if (/^https?:\/\//i.test(reference) || reference.startsWith("data:")) {
    return reference;
  }
  const path = absoluteInputPath(reference);
  const mime = INPUT_MIME[extname(path).toLowerCase()];
  if (!mime) {
    throw new ImageGenError("provider", `不支持的输入图片格式: ${reference}`, {
      kind: "validation",
    });
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new ImageGenError("provider", `无法读取输入图片: ${path}`, {
      kind: "validation",
      cause: error,
    });
  }
  if (bytes.length > MAX_INPUT_FILE_BYTES) {
    throw new ImageGenError(
      "provider",
      `输入图片过大: ${path}（${bytes.length} 字节，上限 ${MAX_INPUT_FILE_BYTES}）`,
      { kind: "validation" },
    );
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

type BuiltInput = {
  wireInput: Record<string, unknown>;
  resolvedInput: Record<string, unknown>;
};

async function buildModelInput(
  spec: ModelSpec,
  request: ImageGenerationRequest,
): Promise<BuiltInput> {
  const isEdit = (request.inputImages?.length ?? 0) > 0;
  if (isEdit && !spec.sources.includes("image_edit")) {
    throw new ImageGenError("provider", `模型 ${spec.id} 不支持图生图`, { kind: "validation" });
  }

  const input: Record<string, unknown> = { prompt: request.prompt };

  if (request.negativePrompt !== undefined && request.negativePrompt !== "") {
    if (!spec.negativePromptKey) {
      throw new ImageGenError("provider", `模型 ${spec.id} 不支持 negativePrompt`, {
        kind: "validation",
      });
    }
    input[spec.negativePromptKey] = request.negativePrompt;
  }

  if (request.steps !== undefined) {
    if (!spec.stepsKey) {
      throw new ImageGenError("provider", `模型 ${spec.id} 不支持 steps`, {
        kind: "validation",
      });
    }
    input[spec.stepsKey] = request.steps;
  }

  if (request.guidance !== undefined) {
    if (!spec.guidanceKey) {
      throw new ImageGenError("provider", `模型 ${spec.id} 不支持 guidance`, {
        kind: "validation",
      });
    }
    input[spec.guidanceKey] = request.guidance;
  }

  if (request.seed !== undefined) {
    if (!spec.seedKey) {
      throw new ImageGenError("provider", `模型 ${spec.id} 不支持 seed`, {
        kind: "validation",
      });
    }
    input[spec.seedKey] = request.seed;
  }

  const aspectRatio = resolveAspectRatio(spec, request, isEdit);
  if (aspectRatio !== undefined) {
    input.aspect_ratio = aspectRatio;
  }

  if (request.width !== undefined && request.height !== undefined) {
    if (spec.widthKey) {
      input[spec.widthKey] = request.width;
    }
    if (spec.heightKey) {
      input[spec.heightKey] = request.height;
    }
  }

  if (request.outputFormat !== undefined) {
    if (!spec.outputFormatKey || !spec.outputFormats.includes(request.outputFormat)) {
      throw new ImageGenError(
        "provider",
        `模型 ${spec.id} 不支持输出格式 ${request.outputFormat}`,
        { kind: "validation" },
      );
    }
    input[spec.outputFormatKey] = request.outputFormat;
  } else if (spec.outputFormatKey && spec.defaultOutputFormat) {
    input[spec.outputFormatKey] = spec.defaultOutputFormat;
  }

  const extraInputs = new Set(spec.extraInputs ?? []);
  for (const [key, value] of Object.entries(request.providerOptions ?? {})) {
    if (RESERVED_INPUT_KEYS.has(key)) {
      throw new ImageGenError("provider", `providerOptions 不能覆盖保留字段: ${key}`, {
        kind: "validation",
      });
    }
    if (!extraInputs.has(key)) {
      throw new ImageGenError("provider", `模型 ${spec.id} 不支持 providerOptions.${key}`, {
        kind: "validation",
      });
    }
    input[key] = value;
  }

  if (spec.fixedInputs) {
    for (const [key, value] of Object.entries(spec.fixedInputs)) {
      input[key] ??= value;
    }
  }

  const images = request.inputImages ?? [];
  let imagePlaceholders: string[] = [];
  if (images.length > 0) {
    if (!spec.imageInputsKey) {
      throw new ImageGenError("provider", `模型 ${spec.id} 不支持图生图`, {
        kind: "validation",
      });
    }
    if (spec.imageInputsMode === "single" && images.length > 1) {
      throw new ImageGenError("provider", `模型 ${spec.id} 只接受一张输入图片`, {
        kind: "validation",
      });
    }
    const urls = await Promise.all(images.map(inputReferenceToUrl));
    input[spec.imageInputsKey] = spec.imageInputsMode === "single" ? urls[0] : urls;
    imagePlaceholders = images.map((reference) => `<input:${reference}>`);
  }

  const resolvedInput: Record<string, unknown> = { ...input };
  if (spec.imageInputsKey && images.length > 0) {
    resolvedInput[spec.imageInputsKey] =
      spec.imageInputsMode === "single" ? imagePlaceholders[0] : imagePlaceholders;
  }

  return { wireInput: input, resolvedInput };
}

type Prediction = {
  id: string;
  status: string;
  output: unknown;
  error: unknown;
  logs: unknown;
  metrics: unknown;
  urls: { get?: unknown };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePrediction(value: unknown): Prediction {
  if (!isRecord(value)) {
    throw new ImageGenError("provider", "预测响应不是对象", { kind: "api" });
  }
  const id = asString(value.id);
  const status = asString(value.status);
  if (!id || !status) {
    throw new ImageGenError("provider", "预测响应缺少 id / status", {
      kind: "api",
      details: value,
    });
  }
  const urls = isRecord(value.urls) ? value.urls : {};
  return {
    id,
    status,
    output: value.output,
    error: value.error,
    logs: value.logs,
    metrics: value.metrics,
    urls: { get: urls.get },
  };
}

function isSuccessStatus(status: string): boolean {
  return status === "succeeded" || status === "successful";
}

function isFailureStatus(status: string): boolean {
  return status === "failed" || status === "canceled" || status === "cancelled";
}

function errorText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    return asString(value.detail) ?? asString(value.message) ?? JSON.stringify(value);
  }
  return value === null || value === undefined ? "" : String(value);
}

function outputUrls(output: unknown): string[] {
  const collect = (value: unknown): string[] => {
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap(collect);
    }
    if (isRecord(value)) {
      const url = asString(value.url) ?? asString(value.image);
      return url ? [url] : [];
    }
    return [];
  };
  return collect(output);
}

function numericMetrics(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  const metrics: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      metrics[key] = raw;
    }
  }
  return metrics;
}

function predictionFailure(prediction: Prediction): ImageGenError {
  const detail = errorText(prediction.error);
  const logs = asString(prediction.logs) ?? "";
  return new ImageGenError(
    "provider",
    `预测 ${prediction.id} 失败（${prediction.status}）${detail ? `: ${detail}` : ""}`,
    {
      kind: "model",
      details: {
        predictionId: prediction.id,
        status: prediction.status,
        error: prediction.error,
        logs: logs.length > 4_000 ? `${logs.slice(-4_000)}…` : logs,
      },
    },
  );
}

export type ReplicateProviderOptions = {
  /** 默认读 `REPLICATE_API_TOKEN`；显式传入时优先。 */
  apiToken?: string;
  baseUrl?: string;
  /** 同步等待秒数，1–60。 */
  waitSeconds?: number;
  /** 预测总时限，到点自动取消。 */
  cancelAfterSeconds?: number;
  /** 本地轮询总超时。 */
  timeoutMs?: number;
  pollIntervalMs?: number;
  fetch?: FetchLike;
  logger?: Logger;
};

export class ReplicateProvider implements ImageProvider {
  readonly id = PROVIDER_ID;

  private readonly apiToken: string | undefined;
  private readonly baseUrl: string;
  private readonly waitSeconds: number;
  private readonly cancelAfterSeconds: number;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger;

  constructor(options: ReplicateProviderOptions = {}) {
    this.apiToken = options.apiToken;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.waitSeconds = options.waitSeconds ?? DEFAULT_WAIT_SECONDS;
    this.cancelAfterSeconds = options.cancelAfterSeconds ?? DEFAULT_CANCEL_AFTER_SECONDS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.logger = options.logger ?? silentLogger;

    if (this.waitSeconds < 1 || this.waitSeconds > 60) {
      throw new RangeError("waitSeconds 必须在 1–60 之间");
    }
    if (this.cancelAfterSeconds < 5 || this.cancelAfterSeconds > 86_400) {
      throw new RangeError("cancelAfterSeconds 必须在 5–86400 之间");
    }
    if (this.pollIntervalMs < 100) {
      throw new RangeError("pollIntervalMs 必须 >= 100");
    }
    if (this.timeoutMs <= 0) {
      throw new RangeError("timeoutMs 必须为正数");
    }
  }

  listModels(): readonly ImageModelInfo[] {
    return MODELS.map(modelInfo);
  }

  supports(model: string): boolean {
    return MODELS_BY_ID.has(model);
  }

  private getApiToken(): string {
    const token = this.apiToken ?? process.env[API_TOKEN_ENV];
    if (!token || token.trim().length === 0) {
      throw new ImageGenError("provider", `${API_TOKEN_ENV} 未配置`, { kind: "config" });
    }
    return token;
  }

  private headers(contentType = false): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.getApiToken()}`,
      Accept: "application/json",
    };
    if (contentType) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  private async readJson(response: Response, label: string): Promise<unknown> {
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      let detail = text;
      try {
        const body: unknown = JSON.parse(text);
        if (isRecord(body)) {
          detail = [asString(body.title), asString(body.detail)].filter(Boolean).join(": ");
        }
      } catch {
        // 非 JSON 错误体保留原文。
      }
      throw new ImageGenError(label, `HTTP ${response.status}${detail ? `: ${detail}` : ""}`, {
        kind: "api",
        statusCode: response.status,
        details: text.slice(0, 2_000),
      });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new ImageGenError(label, "响应不是合法 JSON", {
        kind: "api",
        statusCode: response.status,
        cause: error,
        details: text.slice(0, 2_000),
      });
    }
  }

  async checkConnection(): Promise<ProviderStatus> {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/models?limit=1`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new ImageGenError("provider", `连接失败: ${String(error)}`, {
        kind: "connection",
        cause: error,
      });
    }
    await this.readJson(response, "provider");
    return {
      ok: true,
      latencyMs: performance.now() - startedAt,
      detail: `HTTP ${response.status}`,
    };
  }

  async generate(
    request: ImageGenerationRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<ProviderGeneration> {
    const parsed = imageGenerationRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ImageGenError("provider", "生成请求校验失败", {
        kind: "validation",
        details: parsed.error.issues,
      });
    }
    const spec = getSpec(parsed.data.model);
    const startedAt = performance.now();
    const { wireInput, resolvedInput } = await buildModelInput(spec, parsed.data);

    const prediction = await this.createPrediction(spec, wireInput, options.signal);
    const completed = await this.waitForPrediction(prediction, options.signal);
    const urls = outputUrls(completed.output);
    if (urls.length === 0) {
      throw new ImageGenError("provider", `预测 ${completed.id} 成功但没有图片输出`, {
        kind: "model",
        details: { predictionId: completed.id, status: completed.status },
      });
    }

    const logs = asString(completed.logs) ?? "";
    this.logger.info(
      `图像生成完成: model=${spec.id} prediction=${completed.id} outputs=${urls.length} ` +
        `elapsed=${(performance.now() - startedAt).toFixed(0)}ms`,
    );

    return {
      predictionId: completed.id,
      model: spec.id,
      modelRef: spec.ref,
      outputUrls: urls,
      resolvedInput,
      logs,
      metrics: numericMetrics(completed.metrics),
      elapsedMs: performance.now() - startedAt,
    };
  }

  private async createPrediction(
    spec: ModelSpec,
    input: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Prediction> {
    const [modelPath = "", version] = spec.ref.split(":");
    const segments = modelPath.split("/");
    if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
      throw new ImageGenError("provider", `模型引用非法: ${spec.ref}`, { kind: "config" });
    }

    const endpoint =
      version === undefined
        ? `${this.baseUrl}/v1/models/${segments[0]}/${segments[1]}/predictions`
        : `${this.baseUrl}/v1/predictions`;
    const body: Record<string, unknown> = { input };
    if (version !== undefined) {
      body.version = version;
    }

    this.logger.debug(`提交图像预测: model=${spec.id} endpoint=${endpoint}`);
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          ...this.headers(true),
          Prefer: `wait=${this.waitSeconds}`,
          "Cancel-After": `${this.cancelAfterSeconds}s`,
        },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout((this.waitSeconds + 15) * 1_000)])
          : AbortSignal.timeout((this.waitSeconds + 15) * 1_000),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const kind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "connection";
      throw new ImageGenError("provider", `提交预测失败: ${String(error)}`, {
        kind,
        cause: error,
      });
    }

    return parsePrediction(await this.readJson(response, "provider"));
  }

  private async waitForPrediction(
    initial: Prediction,
    signal: AbortSignal | undefined,
  ): Promise<Prediction> {
    const deadline = performance.now() + this.timeoutMs;
    let prediction = initial;

    while (true) {
      if (isFailureStatus(prediction.status)) {
        throw predictionFailure(prediction);
      }
      // 文件产物可能先于终态就绪：只要拿到 URL 就不必再等状态翻转。
      if (isSuccessStatus(prediction.status) || outputUrls(prediction.output).length > 0) {
        return prediction;
      }
      if (performance.now() >= deadline) {
        throw new ImageGenError("provider", `预测 ${prediction.id} 超时（${prediction.status}）`, {
          kind: "timeout",
          details: { predictionId: prediction.id, status: prediction.status },
        });
      }

      const pollUrl =
        asString(prediction.urls.get) ?? `${this.baseUrl}/v1/predictions/${prediction.id}`;
      try {
        await delay(this.pollIntervalMs, undefined, { signal });
      } catch (error) {
        throw new ImageGenError("provider", `等待预测时被取消: ${String(error)}`, {
          kind: "timeout",
          cause: error,
        });
      }

      let response: Response;
      try {
        response = await this.fetchImpl(pollUrl, {
          method: "GET",
          headers: this.headers(),
          signal: signal
            ? AbortSignal.any([
                signal,
                AbortSignal.timeout(Math.max(1_000, Math.ceil(deadline - performance.now()))),
              ])
            : AbortSignal.timeout(Math.max(1_000, Math.ceil(deadline - performance.now()))),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        const kind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "connection";
        throw new ImageGenError("provider", `轮询预测失败: ${String(error)}`, {
          kind,
          cause: error,
        });
      }

      prediction = parsePrediction(await this.readJson(response, "provider"));
    }
  }
}

export function createReplicateProvider(options: ReplicateProviderOptions = {}): ReplicateProvider {
  return new ReplicateProvider(options);
}
