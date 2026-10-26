/**
 * 通讯层错误模型（provider 无关）。
 *
 * 通讯层只记录与抛出，**不做重试**；`retryable` 是给业务层决定重试策略的元数据。
 */

export type ErrorKind = "timeout" | "connection" | "api";

/** 明确属于「重试可能成功」的瞬时 HTTP 状态码。 */
const RETRYABLE_STATUS_CODES = new Set([408, 429]);

export type ChatErrorOptions = {
  kind: ErrorKind;
  statusCode?: number;
  details?: unknown;
  cause?: unknown;
};

export class ChatError extends Error {
  readonly label: string;
  readonly kind: ErrorKind;
  readonly statusCode: number | undefined;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(label: string, message: string, options: ChatErrorOptions) {
    super(`[${label}] ${message}`, { cause: options.cause });
    this.name = "ChatError";
    this.label = label;
    this.kind = options.kind;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.retryable = ChatError.isRetryable(options.kind, options.statusCode);
  }

  /** 网络层错误一律可重试；HTTP 层仅 408/429/5xx 可重试。 */
  static isRetryable(kind: ErrorKind, statusCode: number | undefined): boolean {
    if (kind === "timeout" || kind === "connection") {
      return true;
    }
    if (statusCode === undefined) {
      return false;
    }
    return RETRYABLE_STATUS_CODES.has(statusCode) || statusCode >= 500;
  }
}
