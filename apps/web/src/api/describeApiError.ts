import { ApiError } from "@ai-trpg/api-client";

/** 把传输错误 / 服务端结构化错误统一成一句可展示的中文。 */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body;
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
    return `请求失败（HTTP ${error.status}）`;
  }

  if (error instanceof TypeError) {
    return "无法连接服务端，请确认服务已启动且地址正确";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "未知错误";
}
