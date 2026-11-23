/**
 * HTTP 层的错误：带状态码与机器可读枚举，由 `plugins/error-handler` 统一渲染。
 *
 * 业务错误不要在这里新建类型；只有传输层的判断（未登录、找不到用户）走它。
 */

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
