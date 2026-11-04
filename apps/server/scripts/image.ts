/**
 * 图像生成独立 CLI（不启动服务端、不连数据库）。
 *
 *   pnpm image <command> [options]
 *
 * 命令、参数与默认值以 `--help` 为准；相对输入路径按仓库根解析。
 * stdout 只放结果：默认人类可读摘要，`--json` 时输出稳定结构供 agent 消费；
 * 进程日志与用法错误一律走 stderr，且 `--json` 下错误也必须是 JSON。
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { Command, CommanderError, Option } from "commander";
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

/** CLI 日志一律走 stderr，避免污染 `--json` 的 stdout。 */
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

const service = new ImageGenerationService({
  provider: createImageProvider({ logger: cliLogger }),
  logger: silentLogger,
});

/** commander 用这几个 code 表示「帮助/版本已输出」，属于成功路径。 */
const DISPLAY_CODES = new Set(["commander.help", "commander.helpDisplayed", "commander.version"]);

const HELP_TIP = [
  "",
  "示例：",
  '  pnpm image generate "黄昏的小酒馆" --aspect-ratio 16:9 --format png',
  '  pnpm image edit --input a.png --prompt "换成水彩风格"',
  "  pnpm image batch --file specs.json --concurrency 2",
  "",
  "edit：--input 可重复，支持本地路径、HTTP(S) URL 或 data URL。",
  'batch：JSON 为请求数组，或 { "requests": [...] }；字段同 generate/edit。',
  "相对输入路径按仓库根解析；加 --json 输出机器可读结果。",
].join("\n");

// ---------------------------------------------------------------- 输出与失败

/** commander 的文本输出出口：`--json` 时改成收集，避免文本污染 stdout。 */
type OutputSinks = {
  out: (text: string) => void;
  err: (text: string) => void;
};

const standardSinks: OutputSinks = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

type CliContext = {
  /** 当前命令是否要求机器可读输出；由 action 从 `--json` 解析后写入。 */
  json: boolean;
  /** 部分失败（如 batch 有请求出错）时置退出码，结果本身照常输出。 */
  setExitCode: (code: number) => void;
};

function emit(
  ctx: CliContext,
  payload: Record<string, unknown>,
  humanLines: readonly string[],
  exitCode = 0,
): void {
  if (exitCode !== 0) {
    ctx.setExitCode(exitCode);
  }
  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  for (const line of humanLines) {
    console.log(line);
  }
}

function fail(message: string): never {
  throw new Error(message);
}

/** zod 的 issues 数组压成一行，避免把原始结构直接抛给调用方。 */
function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map(describeIssue).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/** 文案里已经点名了字段（`--steps 必须是正整数`）时就不再加一遍路径前缀。 */
function describeIssue(issue: z.ZodIssue): string {
  if (issue.path.length === 0) {
    return issue.message;
  }
  const leaf = String(issue.path.at(-1));
  return issue.message.includes(leaf) ? issue.message : `${issue.path.join(".")}: ${issue.message}`;
}

function reportFailure(error: unknown, json: boolean): void {
  const message = describeError(error);
  const payload: Record<string, unknown> =
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
  if (json) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  console.error(`❌ ${message}`);
  if (error instanceof ImageGenError && error.details !== undefined) {
    console.error(JSON.stringify(error.details, null, 2));
  }
}

// -------------------------------------------------------------- 参数解析原语

/**
 * 选项值一律以字符串到达；这一层同时给出类型、校验与中文文案，
 * 校验失败的措辞会原样出现在 CLI 输出里。
 */
function positiveInt(label: string) {
  return z
    .string()
    .trim()
    .refine((raw) => /^\d+$/.test(raw) && Number(raw) > 0, `${label} 必须是正整数`)
    .transform(Number);
}

function int(label: string) {
  return z
    .string()
    .trim()
    .refine((raw) => /^-?\d+$/.test(raw), `${label} 必须是整数`)
    .transform(Number);
}

function nonNegativeFloat(label: string) {
  return z
    .string()
    .trim()
    .refine((raw) => /^\d+(?:\.\d+)?$/.test(raw), `${label} 必须是非负数字`)
    .transform(Number);
}

/** 输出格式沿用 `normalizeImageFormat`，与下载/落盘时的判定保持同一套别名。 */
const imageFormat = z.string().transform((raw, ctx) => {
  const format = normalizeImageFormat(raw);
  if (format === undefined) {
    ctx.addIssue({ code: "custom", message: "--format 必须是 png / jpg / webp" });
    return z.NEVER;
  }
  return format;
});

const optionalText = (label: string) =>
  z.string().trim().min(1, `${label} 需要非空字符串`).optional();

/** 可重复选项：commander 每次调用只给单值，这里累积成数组。 */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

// ------------------------------------------------------------ 请求组装与命令

/**
 * 生成类命令共用的选项形状。模型是否真的支持某个字段由 provider 能力决定，
 * 这里只管「参数本身是否合法」。
 */
const requestOptions = z.object({
  model: optionalText("--model"),
  negative: optionalText("--negative"),
  "aspect-ratio": optionalText("--aspect-ratio"),
  width: positiveInt("--width").optional(),
  height: positiveInt("--height").optional(),
  format: imageFormat.optional(),
  seed: int("--seed").optional(),
  steps: positiveInt("--steps").optional(),
  guidance: nonNegativeFloat("--guidance").optional(),
  option: z.array(z.string()).optional(),
});

type RequestOptions = z.infer<typeof requestOptions>;

/** `--option key=value`：布尔与数字按字面量类型下发，其余保持字符串。 */
function scalarValue(text: string): string | number | boolean {
  if (text === "true" || text === "false") {
    return text === "true";
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return text;
}

function toProviderOptions(
  raw: readonly string[] | undefined,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const item of raw ?? []) {
    const index = item.indexOf("=");
    if (index <= 0) {
      fail(`--option 需要 key=value 形式: ${item}`);
    }
    const key = item.slice(0, index).trim();
    result[key] = scalarValue(item.slice(index + 1).trim());
  }
  return result;
}

/** `.strict()` 下「没传」应当是键缺席；把 undefined 一并剔掉，省掉逐字段的条件展开。 */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function toRequest(
  options: RequestOptions,
  prompt: string,
  inputImages: readonly string[] = [],
): ImageGenerationRequest {
  const providerOptions = toProviderOptions(options.option);
  return imageGenerationRequestSchema.parse({
    model: options.model ?? DEFAULT_IMAGE_MODEL,
    prompt,
    ...compact({
      negativePrompt: options.negative,
      aspectRatio: options["aspect-ratio"],
      width: options.width,
      height: options.height,
      outputFormat: options.format,
      seed: options.seed,
      steps: options.steps,
      guidance: options.guidance,
    }),
    ...(inputImages.length > 0 ? { inputImages: [...inputImages] } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  });
}

/** 位置参数优先、`--prompt` 兜底：generate 与 edit 用同一套规则。 */
function resolvePrompt(
  command: string,
  positional: string | undefined,
  flag: string | undefined,
): string {
  const prompt = positional?.trim() || flag?.trim();
  if (!prompt) {
    fail(`${command} 需要 prompt：位置参数或 --prompt`);
  }
  return prompt;
}

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

function summarize(image: { meta: ImageMeta; path: string; metaPath: string }): string[] {
  return [
    "✅ 生成完成",
    `   图片: ${repoRelative(image.path)}`,
    `   meta: ${repoRelative(image.metaPath)}`,
    `   模型: ${image.meta.model} (${image.meta.modelRef})`,
    `   预测: ${image.meta.predictionId}`,
  ];
}

const promptOption = () => new Option("-p, --prompt <text>", "提示词；位置参数优先于本选项");

const inputOption = () =>
  new Option(
    "-i, --input <path>",
    "图生图输入，可重复；本地路径、HTTP(S) URL 或 data URL",
  ).argParser(collect);

const jsonOption = () => new Option("--json", "输出 JSON（错误也输出 JSON 到 stderr）");

/** 生成类命令共用的 flags；字段与 `requestOptions` 一一对应。 */
function generationOptions(): Option[] {
  return [
    new Option("-m, --model <id>", `模型（默认 ${DEFAULT_IMAGE_MODEL}）`),
    promptOption(),
    new Option("-a, --aspect-ratio <r>", "宽高比，如 16:9；也可用 --width/--height 推导"),
    new Option("--width <px>", "目标宽度（模型支持时）"),
    new Option("--height <px>", "目标高度（模型支持时）"),
    new Option("-f, --format <fmt>", "输出格式：png / jpg / webp"),
    new Option("-n, --negative <text>", "负向提示词（模型支持时）"),
    new Option("-s, --steps <n>", "推理步数（模型支持时）"),
    new Option("--seed <n>", "随机种子，可为负（模型支持时）"),
    new Option("-g, --guidance <f>", "引导强度，非负（模型支持时）"),
    new Option("-o, --option <key=value>", "厂商专属参数，可重复；白名单由模型决定").argParser(
      collect,
    ),
    jsonOption(),
  ];
}

const generateInput = requestOptions.extend({
  prompt: optionalText("--prompt"),
  input: z.array(z.string()).optional(),
});

async function commandGenerate(
  input: z.infer<typeof generateInput>,
  positional: string | undefined,
  ctx: CliContext,
): Promise<void> {
  if ((input.input ?? []).length > 0) {
    fail("generate 只做文生图；图生图请用 edit");
  }
  const prompt = resolvePrompt("generate", positional, input.prompt);
  const image = await service.generateText(toRequest(input, prompt));
  emit(ctx, { ok: true, image: imagePayload(image) }, summarize(image));
}

const editInput = requestOptions.extend({
  prompt: optionalText("--prompt"),
  input: z.array(z.string().trim().min(1, "--input 需要非空路径")).optional(),
});

async function commandEdit(
  input: z.infer<typeof editInput>,
  positional: string | undefined,
  ctx: CliContext,
): Promise<void> {
  const inputs = input.input ?? [];
  if (inputs.length === 0) {
    fail("edit 至少需要一个 --input（可重复）");
  }
  const prompt = resolvePrompt("edit", positional, input.prompt);
  const request = toRequest(input, prompt, inputs);
  const image = await service.edit({
    ...request,
    inputImages: inputs as [string, ...string[]],
  });
  emit(ctx, { ok: true, image: imagePayload(image) }, summarize(image));
}

const batchEnvelopeSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ requests: z.array(z.record(z.string(), z.unknown())) }).strict(),
]);

const batchInput = z.object({
  file: z.string({ error: "batch 需要 --file" }).trim().min(1, "batch 需要 --file"),
  concurrency: positiveInt("--concurrency").optional(),
});

async function commandBatch(
  input: z.infer<typeof batchInput>,
  _positional: string | undefined,
  ctx: CliContext,
): Promise<void> {
  const text = await readFile(input.file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    fail(`batch 文件不是合法 JSON: ${String(error)}`);
  }
  const envelope = batchEnvelopeSchema.parse(raw);
  const entries = Array.isArray(envelope) ? envelope : envelope.requests;

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

  const results = await service.batch(requests, {
    maxConcurrency: input.concurrency ?? 2,
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
  emit(ctx, payload, lines, failed === 0 ? 0 : 1);
}

const listInput = z.object({
  limit: positiveInt("--limit").optional(),
});

async function commandList(
  input: z.infer<typeof listInput>,
  _positional: string | undefined,
  ctx: CliContext,
): Promise<void> {
  const images = await service.listImages();
  const selected = images.slice(0, input.limit ?? 20);
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
    ctx,
    payload,
    selected.length === 0
      ? ["还没有生成任何图片。"]
      : selected.map(
          (image) =>
            `${image.filename}  ${image.model}  ${image.aspectRatio || "-"}  ${image.prompt.slice(0, 60)}`,
        ),
  );
}

async function commandShow(
  _input: Record<string, never>,
  positional: string | undefined,
  ctx: CliContext,
): Promise<void> {
  const filename = positional?.trim();
  if (!filename) {
    fail("show 需要 filename 或 meta 路径");
  }
  const meta = await service.readImage(filename);
  const path = service.store.pathFor(meta.filename);
  const metaPath = service.store.metaPathFor(meta.filename);
  emit(
    ctx,
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

async function commandModels(
  _input: Record<string, never>,
  _positional: string | undefined,
  ctx: CliContext,
): Promise<void> {
  const models = service.listModels();
  emit(
    ctx,
    { ok: true, models },
    models.map(
      (model) =>
        `${model.id.padEnd(28)} ${model.label.padEnd(28)} ` +
        `[${model.capabilities.sources.join(",")}] formats=${model.capabilities.outputFormats.join("|") || "-"}`,
    ),
  );
}

async function commandCheck(
  _input: Record<string, never>,
  _positional: string | undefined,
  ctx: CliContext,
): Promise<void> {
  const status = await service.checkConnection();
  emit(ctx, { ok: true, latencyMs: status.latencyMs, detail: status.detail }, [
    `✅ 连接正常（${status.latencyMs.toFixed(0)}ms，${status.detail}）`,
  ]);
}

// ---------------------------------------------------------------- 命令装配

/**
 * 一个子命令 = 一段 help 文案 + 一份 zod schema + 一个执行函数。
 * 新增命令只加一个描述符；校验、`--json` 判定与退出码都在这里统一处理。
 */
type CommandDefinition<T extends z.ZodType> = {
  name: string;
  /** 手顺别名，例如 `gen` / `ls`。 */
  aliases?: readonly string[];
  summary: string;
  /** 位置参数：`[flags, 说明]`；声明后 action 会把它作为 `positional` 传进来。 */
  argument?: readonly [string, string];
  options?: readonly Option[];
  schema: T;
  run: (input: z.infer<T>, positional: string | undefined, ctx: CliContext) => Promise<void>;
};

function addCommand<T extends z.ZodType>(
  parent: Command,
  ctx: CliContext,
  def: CommandDefinition<T>,
): void {
  const command = parent
    .command(def.name)
    .description(def.summary)
    .helpOption("-h, --help", "显示帮助");
  if (def.aliases !== undefined) {
    command.aliases([...def.aliases]);
  }
  if (def.argument !== undefined) {
    command.argument(def.argument[0], def.argument[1]);
  }
  for (const option of def.options ?? []) {
    command.addOption(option);
  }
  command.action(async (...actionArgs: unknown[]) => {
    const invoked = actionArgs.at(-1) as Command;
    const options = actionArgs.at(-2) as Record<string, unknown>;
    const positional =
      def.argument === undefined ? undefined : (actionArgs[0] as string | undefined);
    ctx.json = invoked.optsWithGlobals().json === true;
    await def.run(def.schema.parse(options), positional, ctx);
  });
}

function createProgram(ctx: CliContext, sinks: OutputSinks): Command {
  const program = new Command("pnpm image")
    .description("图像生成基建 CLI：独立运行，不启动服务端、不连数据库。")
    .addHelpText("after", HELP_TIP)
    .helpOption("-h, --help", "显示帮助")
    .helpCommand("help [command]", "查看某个子命令的帮助")
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride();
  // 子命令各自也声明了 `--json`，这里再声明一次是为了兼容写在子命令之前的写法。
  program.addOption(jsonOption());
  // 必须在装配子命令之前设置，子命令创建时才继承这份输出配置。
  program.configureOutput({ writeOut: sinks.out, writeErr: sinks.err });

  addCommand(program, ctx, {
    name: "generate",
    aliases: ["gen"],
    summary: "文生图",
    argument: ["[prompt]", "提示词；与 --prompt 二选一"],
    options: [...generationOptions(), inputOption()],
    schema: generateInput,
    run: commandGenerate,
  });

  addCommand(program, ctx, {
    name: "edit",
    aliases: ["img2img"],
    summary: "图生图 / 编辑",
    argument: ["[prompt]", "提示词；与 --prompt 二选一"],
    options: [...generationOptions(), inputOption()],
    schema: editInput,
    run: commandEdit,
  });

  addCommand(program, ctx, {
    name: "batch",
    summary: "按 JSON 批量生成",
    options: [
      new Option("--file <path>", "请求数组，或 { requests: [...] }"),
      new Option("--concurrency <n>", "并发数（默认 2）"),
      jsonOption(),
    ],
    schema: batchInput,
    run: commandBatch,
  });

  addCommand(program, ctx, {
    name: "list",
    aliases: ["ls"],
    summary: "列出已生成的图片",
    options: [new Option("-l, --limit <n>", "最多显示多少条（默认 20）"), jsonOption()],
    schema: listInput,
    run: commandList,
  });

  addCommand(program, ctx, {
    name: "show",
    summary: "查看单张图片的元数据",
    argument: ["[filename]", "文件名或 meta 路径"],
    options: [jsonOption()],
    schema: z.object({}),
    run: commandShow,
  });

  addCommand(program, ctx, {
    name: "models",
    summary: "列出可用模型及其能力",
    options: [jsonOption()],
    schema: z.object({}),
    run: commandModels,
  });

  addCommand(program, ctx, {
    name: "check",
    summary: "检查 provider 连通性",
    options: [jsonOption()],
    schema: z.object({}),
    run: commandCheck,
  });

  return program;
}

/** CLI 主入口：返回退出码而不是直接 `process.exit`，便于测试驱动与复用。 */
async function runImageCli(argv: readonly string[]): Promise<number> {
  const json = argv.includes("--json");
  let captured = "";
  const sinks: OutputSinks = json
    ? {
        out: (text) => {
          captured += text;
        },
        err: (text) => {
          captured += text;
        },
      }
    : standardSinks;
  let exitCode = 0;
  const ctx: CliContext = {
    json,
    setExitCode: (code) => {
      exitCode = code;
    },
  };
  const program = createProgram(ctx, sinks);

  try {
    // 没有子命令等同 `--help`，仍算成功路径。
    if (argv.filter((token) => !token.startsWith("-")).length === 0) {
      program.outputHelp();
      if (json) {
        emit(ctx, { ok: true, help: captured.trim() }, []);
      }
      return 0;
    }
    await program.parseAsync([...argv], { from: "user" });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (DISPLAY_CODES.has(error.code)) {
        if (json) {
          emit(ctx, { ok: true, help: captured.trim() }, []);
        }
        return 0;
      }
      // commander 已把用法错误写进 sinks；`--json` 时改为机器可读的错误信封。
      if (json) {
        const message = error.message.replace(/^error: /, "");
        process.stderr.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
      }
      return 1;
    }
    reportFailure(error, json);
    return 1;
  }
}

runImageCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    reportFailure(error, process.argv.includes("--json"));
    process.exitCode = 1;
  });
