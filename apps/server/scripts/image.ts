/**
 * 图像生成独立 CLI（不启动服务端、不连数据库）。
 *
 *   pnpm image <command> [options]
 *
 * 命令与参数以 `--help` 为准；相对输入路径按仓库根解析。
 * 成功时默认输出人类可读摘要，加 `--json` 输出稳定结构供 agent 消费。
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { config as loadEnvFile } from "dotenv";
import { z } from "zod";
import { ROOT_ENV_FILE } from "../src/env";
import {
  createImageProvider,
  DEFAULT_IMAGE_MODEL,
  ImageGenError,
  type ImageGenerationRequest,
  ImageGenerationService,
  type ImageMeta,
  imageGenerationRequestSchema,
  normalizeImageFormat,
} from "../src/imagegen";
import { type Logger, silentLogger } from "../src/logging";
import { findRepoRoot } from "../src/paths";

loadEnvFile({ path: ROOT_ENV_FILE, quiet: true });

const cliOptions = {
  model: { type: "string", short: "m" },
  prompt: { type: "string", short: "p" },
  input: { type: "string", short: "i", multiple: true },
  negative: { type: "string", short: "n" },
  "aspect-ratio": { type: "string", short: "a" },
  width: { type: "string", short: "w" },
  height: { type: "string" },
  format: { type: "string", short: "f" },
  seed: { type: "string" },
  steps: { type: "string", short: "s" },
  guidance: { type: "string", short: "g" },
  option: { type: "string", short: "o", multiple: true },
  file: { type: "string" },
  concurrency: { type: "string" },
  limit: { type: "string", short: "l" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type CliValues = {
  model?: string | boolean;
  prompt?: string | boolean;
  input?: string | boolean | string[];
  negative?: string | boolean;
  "aspect-ratio"?: string | boolean;
  width?: string | boolean;
  height?: string | boolean;
  format?: string | boolean;
  seed?: string | boolean;
  steps?: string | boolean;
  guidance?: string | boolean;
  option?: string | boolean | string[];
  file?: string | boolean;
  concurrency?: string | boolean;
  limit?: string | boolean;
  json?: string | boolean;
  help?: string | boolean;
};

/** CLI 日志一律走 stderr，避免污染 --json 的 stdout。 */
const cliLogger: Logger = {
  debug: (message, ...args) => {
    if (process.env.LOG_LEVEL === "debug" || process.env.LOG_LEVEL === "trace") {
      console.error(message, ...args);
    }
  },
  info: (message, ...args) => console.error(message, ...args),
  warn: (message, ...args) => console.error(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};

const provider = createImageProvider({ logger: cliLogger });
const service = new ImageGenerationService({ provider, logger: silentLogger });
let outputJson = false;

function repoRelative(path: string): string {
  return relative(findRepoRoot(), path) || path;
}

function imagePayload(image: {
  meta: ImageMeta;
  path: string;
  metaPath: string;
}): Record<string, unknown> {
  return {
    ...image.meta,
    path: repoRelative(image.path),
    metaPath: repoRelative(image.metaPath),
  };
}

function emit(payload: Record<string, unknown>, humanLines: readonly string[], exitCode = 0): void {
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
  if (outputJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  for (const line of humanLines) {
    console.log(line);
  }
}

function usage(): void {
  emit(
    {
      ok: true,
      usage: [
        "pnpm image generate <prompt> [--model nano-banana] [--aspect-ratio 16:9] [--format png]",
        "pnpm image edit --input <path> [--input <path> ...] --prompt <text> [--model nano-banana]",
        "pnpm image batch --file <specs.json> [--concurrency 2]",
        "pnpm image list [--limit 20]",
        "pnpm image show <filename>",
        "pnpm image models",
        "pnpm image check",
      ],
      tip: "相对输入路径按仓库根解析；加 --json 输出机器可读结果。",
    },
    [
      "图像生成基建 CLI",
      "",
      "用法：",
      "  pnpm image generate <prompt> [options]",
      "  pnpm image edit --input <path> [--input <path> ...] --prompt <text> [options]",
      "  pnpm image batch --file <specs.json> [--concurrency 2]",
      "  pnpm image list [--limit 20]",
      "  pnpm image show <filename>",
      "  pnpm image models",
      "  pnpm image check",
      "",
      "生成选项：",
      `  -m, --model <id>           模型（默认 ${DEFAULT_IMAGE_MODEL}）`,
      "  -a, --aspect-ratio <r>     宽高比，如 16:9；也可用 --width/--height 推导",
      "  -f, --format <fmt>         png / jpg / webp",
      "  -n, --negative <text>      负向提示词（模型支持时）",
      "  -s, --steps <n>            推理步数（模型支持时）",
      "      --seed <n>             随机种子（模型支持时）",
      "  -o, --option key=value     厂商专属参数，可重复；白名单由模型决定",
      "      --json                 输出 JSON",
      "",
      "edit：-i/--input 可重复，支持本地路径、HTTP(S) URL 或 data URL。",
      'batch：JSON 为请求数组，或 { "requests": [...] }；字段同 generate/edit。',
    ],
  );
}

function fail(message: string): never {
  throw new Error(message);
}

function stringValue(value: string | boolean | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${name} 需要非空字符串`);
  }
  return value.trim();
}

function stringList(value: string | boolean | string[] | undefined, name: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`${name} 需要可重复的字符串参数`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function integerValue(
  value: string | boolean | undefined,
  name: string,
  options: { signed?: boolean } = {},
): number | undefined {
  const text = stringValue(value, name);
  if (text === undefined) {
    return undefined;
  }
  const pattern = options.signed ? /^-?\d+$/ : /^\d+$/;
  if (!pattern.test(text)) {
    fail(`${name} 必须是${options.signed ? "" : "正"}整数`);
  }
  return Number(text);
}

function floatValue(value: string | boolean | undefined, name: string): number | undefined {
  const text = stringValue(value, name);
  if (text === undefined) {
    return undefined;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`${name} 必须是非负数字`);
  }
  return parsed;
}

function formatValue(value: string | boolean | undefined): "png" | "jpg" | "webp" | undefined {
  const text = stringValue(value, "--format");
  if (text === undefined) {
    return undefined;
  }
  const format = normalizeImageFormat(text);
  if (!format) {
    fail("--format 必须是 png / jpg / webp");
  }
  return format;
}

function parseOption(raw: string): [string, string | number | boolean] {
  const index = raw.indexOf("=");
  if (index <= 0) {
    fail(`--option 需要 key=value 形式: ${raw}`);
  }
  const key = raw.slice(0, index).trim();
  const text = raw.slice(index + 1).trim();
  if (text === "true" || text === "false") {
    return [key, text === "true"];
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return [key, Number(text)];
  }
  return [key, text];
}

function buildRequest(
  values: CliValues,
  prompt: string,
  inputImages: readonly string[],
): ImageGenerationRequest {
  const providerOptions: Record<string, string | number | boolean> = {};
  const options = values.option;
  if (options !== undefined) {
    if (!Array.isArray(options)) {
      fail("--option 需要可重复的 key=value 参数");
    }
    for (const raw of options) {
      const [key, value] = parseOption(raw);
      providerOptions[key] = value;
    }
  }

  return imageGenerationRequestSchema.parse({
    model: stringValue(values.model, "--model") ?? DEFAULT_IMAGE_MODEL,
    prompt,
    ...(stringValue(values.negative, "--negative") !== undefined
      ? { negativePrompt: stringValue(values.negative, "--negative") }
      : {}),
    ...(stringValue(values["aspect-ratio"], "--aspect-ratio") !== undefined
      ? { aspectRatio: stringValue(values["aspect-ratio"], "--aspect-ratio") }
      : {}),
    ...(integerValue(values.width, "--width") !== undefined
      ? { width: integerValue(values.width, "--width") }
      : {}),
    ...(integerValue(values.height, "--height") !== undefined
      ? { height: integerValue(values.height, "--height") }
      : {}),
    ...(formatValue(values.format) !== undefined
      ? { outputFormat: formatValue(values.format) }
      : {}),
    ...(integerValue(values.seed, "--seed", { signed: true }) !== undefined
      ? { seed: integerValue(values.seed, "--seed", { signed: true }) }
      : {}),
    ...(integerValue(values.steps, "--steps") !== undefined
      ? { steps: integerValue(values.steps, "--steps") }
      : {}),
    ...(floatValue(values.guidance, "--guidance") !== undefined
      ? { guidance: floatValue(values.guidance, "--guidance") }
      : {}),
    ...(inputImages.length > 0 ? { inputImages: [...inputImages] } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  });
}

function summarize(image: { meta: ImageMeta; path: string; metaPath: string }): string[] {
  return [
    "✅ 生成完成",
    `   图片: ${repoRelative(image.path)}`,
    `   meta: ${repoRelative(image.metaPath)}`,
    `   模型: ${image.meta.model} (${image.meta.modelRef})`,
    `   预测: ${image.meta.predictionId}`,
  ];
}

async function commandGenerate(positionals: readonly string[], values: CliValues): Promise<void> {
  if (stringList(values.input, "--input").length > 0) {
    fail("generate 只做文生图；图生图请用 edit");
  }
  const prompt = positionals[1] ?? stringValue(values.prompt, "--prompt");
  if (!prompt) {
    fail("generate 需要 prompt");
  }
  const image = await service.generateText(buildRequest(values, prompt, []));
  emit({ ok: true, image: imagePayload(image) }, summarize(image));
}

async function commandEdit(positionals: readonly string[], values: CliValues): Promise<void> {
  const inputs = stringList(values.input, "--input");
  if (inputs.length === 0) {
    fail("edit 至少需要一个 --input");
  }
  const prompt = stringValue(values.prompt, "--prompt") ?? positionals[1];
  if (!prompt) {
    fail("edit 需要 --prompt");
  }
  const request = buildRequest(values, prompt, inputs);
  const image = await service.edit({
    ...request,
    inputImages: inputs as [string, ...string[]],
  });
  emit({ ok: true, image: imagePayload(image) }, summarize(image));
}

type BatchFile = {
  requests?: unknown;
};

const batchEnvelopeSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ requests: z.array(z.record(z.string(), z.unknown())) }).strict(),
]);

async function commandBatch(values: CliValues): Promise<void> {
  const file = stringValue(values.file, "--file");
  if (!file) {
    fail("batch 需要 --file");
  }
  const text = await readFile(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    fail(`batch 文件不是合法 JSON: ${String(error)}`);
  }
  const envelope = batchEnvelopeSchema.parse(raw) as unknown;
  const entries = Array.isArray(envelope) ? envelope : (envelope as BatchFile).requests;
  if (!Array.isArray(entries)) {
    fail("batch 文件必须是请求数组或 { requests: [...] }");
  }

  const requests = entries.map((entry, index) => {
    const prompt = entry.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      fail(`batch[${index}] 缺少 prompt`);
    }
    const inputImages = Array.isArray(entry.inputImages)
      ? entry.inputImages.filter((item: unknown): item is string => typeof item === "string")
      : [];
    return imageGenerationRequestSchema.parse({
      ...entry,
      model: typeof entry.model === "string" ? entry.model : DEFAULT_IMAGE_MODEL,
      prompt,
      ...(inputImages.length > 0 ? { inputImages } : {}),
    });
  });

  const concurrency = integerValue(values.concurrency, "--concurrency") ?? 2;
  if (concurrency < 1) {
    fail("--concurrency 必须 >= 1");
  }

  const results = await service.batch(requests, {
    maxConcurrency: concurrency,
    logger: cliLogger,
  });
  const failed = results.filter((result) => !result.ok).length;
  const payload = {
    ok: failed === 0,
    total: results.length,
    failed,
    results: results.map((result) =>
      result.ok
        ? { index: result.index, ok: true, image: imagePayload(result.image) }
        : { index: result.index, ok: false, error: result.error },
    ),
  };

  const lines = [
    `批量生成完成: ${results.length - failed}/${results.length} 成功`,
    ...results.map((result) =>
      result.ok
        ? `  ✅ [${result.index}] ${repoRelative(result.image.path)}`
        : `  ❌ [${result.index}] ${result.error}`,
    ),
  ];
  emit(payload, lines, failed === 0 ? 0 : 1);
}

async function commandList(values: CliValues): Promise<void> {
  const limit = integerValue(values.limit, "--limit") ?? 20;
  const images = await service.listImages();
  const selected = images.slice(0, limit);
  const payload = {
    ok: true,
    total: images.length,
    images: selected.map((image) => ({
      ...image,
      path: repoRelative(service.store.pathFor(image.filename)),
      metaPath: repoRelative(service.store.metaPathFor(image.filename)),
    })),
  };
  emit(
    payload,
    selected.length === 0
      ? ["还没有生成任何图片。"]
      : selected.map(
          (image) =>
            `${image.filename}  ${image.model}  ${image.aspectRatio || "-"}  ${image.prompt.slice(0, 60)}`,
        ),
  );
}

async function commandShow(positionals: readonly string[]): Promise<void> {
  const filename = positionals[1];
  if (!filename) {
    fail("show 需要 filename 或 meta 路径");
  }
  const meta = await service.readImage(filename);
  const path = service.store.pathFor(meta.filename);
  const metaPath = service.store.metaPathFor(meta.filename);
  emit(
    { ok: true, image: { ...meta, path: repoRelative(path), metaPath: repoRelative(metaPath) } },
    [
      `filename: ${meta.filename}`,
      `path: ${repoRelative(path)}`,
      `model: ${meta.model} (${meta.modelRef})`,
      `source: ${meta.source}`,
      `prompt: ${meta.prompt}`,
      `aspectRatio: ${meta.aspectRatio || "-"}`,
      `format: ${meta.format}  size: ${meta.sizeBytes} bytes`,
      `prediction: ${meta.predictionId}`,
    ],
  );
}

async function commandModels(): Promise<void> {
  const models = service.listModels();
  emit(
    { ok: true, models },
    models.map(
      (model) =>
        `${model.id.padEnd(28)} ${model.label.padEnd(28)} ` +
        `[${model.capabilities.sources.join(",")}] formats=${model.capabilities.outputFormats.join("|") || "-"}`,
    ),
  );
}

async function commandCheck(): Promise<void> {
  const status = await service.checkConnection();
  emit({ ok: true, latencyMs: status.latencyMs, detail: status.detail }, [
    `✅ 连接正常（${status.latencyMs.toFixed(0)}ms，${status.detail}）`,
  ]);
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: cliOptions,
    allowPositionals: true,
    strict: true,
  });
  const values = parsed.values as CliValues;
  outputJson = values.json === true;
  if (values.help === true) {
    usage();
    return;
  }

  const command = parsed.positionals[0];
  switch (command) {
    case "generate":
    case "gen":
      await commandGenerate(parsed.positionals, values);
      return;
    case "edit":
      await commandEdit(parsed.positionals, values);
      return;
    case "batch":
      await commandBatch(values);
      return;
    case "list":
    case "ls":
      await commandList(values);
      return;
    case "show":
      await commandShow(parsed.positionals);
      return;
    case "models":
      await commandModels();
      return;
    case "check":
      await commandCheck();
      return;
    case undefined:
    case "help":
      usage();
      return;
    default:
      fail(`未知命令: ${command}；用 pnpm image --help 查看用法`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const payload =
    error instanceof ImageGenError
      ? {
          ok: false,
          error: message,
          kind: error.kind,
          statusCode: error.statusCode,
          retryable: error.retryable,
          details: error.details,
        }
      : { ok: false, error: message };
  if (process.argv.includes("--json")) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    console.error(`❌ ${message}`);
    if (error instanceof ImageGenError && error.details !== undefined) {
      console.error(JSON.stringify(error.details, null, 2));
    }
  }
  process.exitCode = 1;
});
