/**
 * HTTP 客户端：一次性进程，一次请求，不缓存世界状态。
 *
 * 与 `agent:game` 的差别只在这层：命令名、参数、输出信封都一致，替换的是
 * 「直连 PostgreSQL」为「请求运行中的服务端」。
 */

import { API_VERSION, DEFAULT_PLAYER_USERNAME, DEFAULT_SERVER_PORT } from "@ai-trpg/shared";

export type ApiClient = {
  base: string;
  token: string;
  call: (request: ApiRequest) => Promise<unknown>;
};

export type ApiRequest = {
  method: "GET" | "POST" | "DELETE";
  /** 以 `/` 开头的 API 路径，例如 `/games/crow-run-1`。 */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export type GlobalFlags = {
  base?: string;
  token?: string;
  timeout?: string;
};

/** 服务端返回的结构化错误。 */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function baseUrl(flag: string | undefined): string {
  const raw = flag ?? process.env.AGENT_API_BASE_URL ?? `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;
  return new URL(raw).toString().replace(/\/+$/, "");
}

/**
 * 开发期身份：`--token` → `AGENT_API_TOKEN` → 玩家身份。
 *
 * 缺省值让人不必每次带 `--token demo`；要换身份（比如用运维看全库）仍然显式传。
 */
function token(flag: string | undefined): string {
  const raw = flag ?? process.env.AGENT_API_TOKEN ?? DEFAULT_PLAYER_USERNAME;
  if (raw.trim().length === 0) {
    throw new ApiFailure(0, "missing_token", "--token 不能为空");
  }
  return raw.trim();
}

function timeoutMs(flag: string | undefined): number {
  const value = Number(flag ?? process.env.AGENT_API_TIMEOUT ?? 120_000);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ApiFailure(0, "invalid_timeout", "--timeout 必须为正数（毫秒）");
  }
  return value;
}

export function createApiClient(flags: GlobalFlags): ApiClient {
  const base = baseUrl(flags.base);
  const auth = token(flags.token);
  const timeout = timeoutMs(flags.timeout);

  return {
    base,
    token: auth,
    async call(request) {
      const url = new URL(`${base}/api/${API_VERSION}${request.path}`);
      for (const [key, value] of Object.entries(request.query ?? {})) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }

      const response = await fetch(url, {
        method: request.method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${auth}`,
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(timeout),
      });

      const text = await response.text();
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        // 非 JSON 响应原样保留，便于排查代理 / 网关错误。
      }

      if (!response.ok) {
        const record =
          typeof payload === "object" && payload !== null
            ? (payload as Record<string, unknown>)
            : {};
        throw new ApiFailure(
          response.status,
          typeof record.error === "string" ? record.error : "request_failed",
          typeof record.message === "string" ? record.message : text,
          record.details,
        );
      }
      return payload;
    },
  };
}
