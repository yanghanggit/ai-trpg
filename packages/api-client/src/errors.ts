/** 非 2xx 响应或响应缺少数据时抛出的错误。`body` 是服务端返回的结构化错误体。 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message = `请求失败（HTTP ${status}）`) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type ApiResult<T> = {
  data?: T;
  error?: unknown;
  response: Response;
};

/** 把 openapi-fetch 的 `{ data, error }` 判别联合收窄成数据，失败时抛出 ApiError。 */
export function unwrap<T>(result: ApiResult<T>): T {
  if (result.error !== undefined) {
    throw new ApiError(result.response.status, result.error);
  }
  if (result.data === undefined) {
    throw new ApiError(result.response.status, undefined, "响应中没有数据");
  }
  return result.data;
}
