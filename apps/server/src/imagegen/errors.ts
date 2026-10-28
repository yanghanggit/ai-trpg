/**
 * 图像生成错误模型（provider 无关）。
 *
 * 传输层只负责分类与抛出，不做自动重试；`retryable` 是给调用方决定重试策略的元数据。
 * `validation` / `config` 是程序或配置错误，重试没有意义。
 */

export type ImageGenErrorKind =
  | "timeout"
  | "connection"
  | "api"
  | "model"
  | "config"
  | "validation";

const RETRYABLE_STATUS_CODES = new Set([408, 429]);

export type ImageGenErrorOptions = {
  kind: ImageGenErrorKind;
  statusCode?: number;
  details?: unknown;
  cause?: unknown;
};

export class ImageGenError extends Error {
  readonly label: string;
  readonly kind: ImageGenErrorKind;
  readonly statusCode: number | undefined;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(label: string, message: string, options: ImageGenErrorOptions) {
    super(`[${label}] ${message}`, { cause: options.cause });
    this.name = "ImageGenError";
    this.label = label;
    this.kind = options.kind;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.retryable = ImageGenError.isRetryable(options.kind, options.statusCode);
  }

  static isRetryable(kind: ImageGenErrorKind, statusCode: number | undefined): boolean {
    if (kind === "timeout" || kind === "connection") {
      return true;
    }
    if (statusCode === undefined) {
      return false;
    }
    return RETRYABLE_STATUS_CODES.has(statusCode) || statusCode >= 500;
  }
}
