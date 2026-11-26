import { ApiError } from "@ai-trpg/api-client";

/**
 * 重试口径：4xx 是确定答案——局不存在、无权访问、参数写错了，重试只会把「现在就看到的错」
 * 推迟七秒，还把页面卡在「读取中」。只有 5xx 与网络错误才值得再试。
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}
