/**
 * 图像资产库：`images/<时间戳>_<uuid>.<ext>` + 同名 `.meta`。
 *
 * - raw 文件与 meta 成对存在，filename 是唯一键，生成后不再变更；
 * - 目录与 URL 由 filename 推导，不写进 meta，避免搬迁后失效；
 * - meta 只记录可安全序列化的生成溯源：本地输入路径、prompt、模型、实际参数；
 *   文件输入的 data URL 不落盘，provider 在返回前替换成占位符；
 * - 写盘顺序是 raw → meta，meta 失败时回滚 raw，避免留下无主文件。
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "../paths";
import { ImageGenError } from "./errors";
import { type ImageLogger, silentLogger } from "./logger";
import {
  type FetchLike,
  type ImageOutputFormat,
  type ImageSource,
  imageOutputFormatSchema,
  imageSourceSchema,
} from "./types";

export const IMAGE_META_SUFFIX = ".meta";
export const IMAGE_META_SCHEMA_VERSION = 1;
export const IMAGE_FORMATS: readonly ImageOutputFormat[] = ["png", "jpg", "webp"];

const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const CONTENT_TYPE_FORMATS: Readonly<Record<string, ImageOutputFormat>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

/** 生成的图片资产元数据；字段是跨 provider 的生成溯源，不含厂商私有调参。 */
export const imageMetaSchema = z.object({
  schemaVersion: z.literal(IMAGE_META_SCHEMA_VERSION).default(IMAGE_META_SCHEMA_VERSION),
  type: z.literal("image").default("image"),
  filename: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  modelRef: z.string().min(1),
  source: imageSourceSchema,
  prompt: z.string(),
  negativePrompt: z.string().default(""),
  aspectRatio: z.string().default(""),
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  seed: z.number().int().nullable().default(null),
  steps: z.number().int().nonnegative().nullable().default(null),
  guidance: z.number().nonnegative().nullable().default(null),
  format: imageOutputFormatSchema,
  inputImages: z.array(z.string()).default([]),
  providerOptions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  sizeBytes: z.number().int().nonnegative(),
  predictionId: z.string().default(""),
  elapsedMs: z.number().nonnegative().default(0),
  createdAt: z.iso.datetime(),
});
export type ImageMeta = z.infer<typeof imageMetaSchema>;

/** 运行时目录固定在仓库根 `images/`；测试可传自己的目录。 */
export function defaultImagesDir(): string {
  return join(findRepoRoot(), "images");
}

export function normalizeImageFormat(value: string | undefined): ImageOutputFormat | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  if (normalized === "jpeg") {
    return "jpg";
  }
  return imageOutputFormatSchema.safeParse(normalized).success
    ? (normalized as ImageOutputFormat)
    : undefined;
}

/** 时间戳在前保证字典序等于创建顺序，uuid 保证同秒并发不冲突。 */
export function newImageFilename(
  format: string,
  now: Date = new Date(),
  uuid: string = randomUUID(),
): string {
  const normalized = normalizeImageFormat(format);
  if (!normalized) {
    throw new ImageGenError("image_filename", `不支持的图片格式: ${format}`, {
      kind: "validation",
    });
  }
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}_${uuid.replace(/-/g, "")}.${normalized}`;
}

/** 从产物 URL 的路径推断真实格式（忽略查询串）。 */
export function imageFormatFromUrl(imageUrl: string): ImageOutputFormat | undefined {
  try {
    return normalizeImageFormat(extname(new URL(imageUrl).pathname));
  } catch {
    return undefined;
  }
}

export function imageFormatFromContentType(
  contentType: string | null | undefined,
): ImageOutputFormat | undefined {
  if (!contentType) {
    return undefined;
  }
  return CONTENT_TYPE_FORMATS[contentType.split(";")[0]?.trim().toLowerCase() ?? ""];
}

/** 字节魔数兜底：URL 与 Content-Type 都不可信时，至少别写错扩展名。 */
export function detectImageFormat(bytes: Uint8Array): ImageOutputFormat | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return undefined;
}

function assertSafeFilename(filename: string): void {
  if (!SAFE_FILENAME.test(filename) || filename.includes("..")) {
    throw new ImageGenError("image_asset", `非法资产文件名: ${filename}`, {
      kind: "validation",
    });
  }
}

/** 原子写文本：同目录临时文件 + rename。 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export type DownloadedImage = {
  bytes: Buffer;
  format: ImageOutputFormat;
  contentType: string;
};

/**
 * 下载远端产物。预期内失败统一抛 `ImageGenError`：
 * 超时 / 连接错误 / 非 2xx / 超限 / 非图片内容。
 */
export async function downloadImage(
  imageUrl: string,
  options: {
    fetch?: FetchLike;
    timeoutMs?: number;
    maxBytes?: number;
    fallbackFormat?: ImageOutputFormat;
  } = {},
): Promise<DownloadedImage> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new ImageGenError("download", `产物 URL 非法: ${imageUrl}`, { kind: "validation" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImageGenError("download", `只支持 http(s) 产物 URL: ${imageUrl}`, {
      kind: "validation",
    });
  }

  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;

  let response: Response;
  try {
    response = await fetchImpl(imageUrl, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const kind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "connection";
    throw new ImageGenError("download", `下载失败: ${String(error)}`, { kind, cause: error });
  }

  if (!response.ok) {
    throw new ImageGenError("download", `下载失败: HTTP ${response.status}`, {
      kind: "api",
      statusCode: response.status,
    });
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ImageGenError("download", `产物过大: ${declaredLength} 字节，上限 ${maxBytes} 字节`, {
      kind: "validation",
    });
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new ImageGenError("download", `产物过大: ${bytes.length} 字节，上限 ${maxBytes} 字节`, {
      kind: "validation",
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  const format =
    imageFormatFromUrl(imageUrl) ??
    imageFormatFromContentType(contentType) ??
    detectImageFormat(bytes) ??
    options.fallbackFormat;

  if (!format) {
    throw new ImageGenError("download", `无法识别产物格式: ${imageUrl}`, {
      kind: "validation",
      details: { contentType },
    });
  }

  return { bytes, format, contentType };
}

export type SavedImageAsset = {
  path: string;
  metaPath: string;
};

/** 本地图片资产库；目录可注入，默认仓库根 `images/`。 */
export class ImageAssetStore {
  readonly dir: string;
  private readonly logger: ImageLogger;

  constructor(options: { dir?: string; logger?: ImageLogger } = {}) {
    this.dir = resolve(options.dir ?? defaultImagesDir());
    this.logger = options.logger ?? silentLogger;
  }

  pathFor(filename: string): string {
    assertSafeFilename(filename);
    return join(this.dir, filename);
  }

  metaPathFor(filename: string): string {
    assertSafeFilename(filename);
    return join(this.dir, `${filename}${IMAGE_META_SUFFIX}`);
  }

  /** 写 raw + meta；meta 失败时回滚 raw，避免产生无主文件。 */
  async save(meta: ImageMeta, bytes: Uint8Array): Promise<SavedImageAsset> {
    const parsed = imageMetaSchema.parse(meta);
    const extension = normalizeImageFormat(extname(parsed.filename));
    if (extension !== parsed.format) {
      throw new ImageGenError(
        "image_asset",
        `文件名扩展名 ${extension ?? "?"} 与 meta.format ${parsed.format} 不一致`,
        { kind: "validation" },
      );
    }
    const record = { ...parsed, sizeBytes: bytes.length };
    const path = this.pathFor(parsed.filename);
    const metaPath = this.metaPathFor(parsed.filename);
    await mkdir(this.dir, { recursive: true });

    const temporary = `${path}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, path);
      await writeFileAtomic(metaPath, `${JSON.stringify(record, null, 2)}\n`);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      await rm(path, { force: true }).catch(() => undefined);
      throw error;
    }

    return { path, metaPath };
  }

  /** 传 filename 或任意指向 meta 的路径都可；空值 / 不存在时抛错。 */
  async readMeta(filenameOrPath: string): Promise<ImageMeta> {
    const basename = filenameOrPath.split(/[\\/]/).pop() ?? "";
    const filename = basename.endsWith(IMAGE_META_SUFFIX)
      ? basename.slice(0, -IMAGE_META_SUFFIX.length)
      : basename;
    const metaPath = this.metaPathFor(filename);

    let text: string;
    try {
      text = await readFile(metaPath, "utf8");
    } catch (error) {
      throw new ImageGenError("image_asset", `meta 不存在: ${metaPath}`, {
        kind: "validation",
        cause: error,
      });
    }

    try {
      return imageMetaSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new ImageGenError("image_asset", `meta 解析失败: ${metaPath}`, {
        kind: "validation",
        cause: error,
      });
    }
  }

  /** 按创建时间倒序列出全部资产；坏 meta 只告警并跳过。 */
  async list(): Promise<ImageMeta[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const metas: ImageMeta[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(IMAGE_META_SUFFIX)) {
        continue;
      }
      try {
        metas.push(await this.readMeta(entry));
      } catch (error) {
        this.logger.warn(`跳过无法读取的图片 meta: ${entry}`, error);
      }
    }
    return metas.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

export function isImageSource(value: string): value is ImageSource {
  return imageSourceSchema.safeParse(value).success;
}
