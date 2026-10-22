/**
 * HTTP API 走查 CLI：一次性进程，一次请求，标准 JSON 输出。
 *
 * 用于 agent 或开发者逐步验证服务端契约；不缓存任何世界状态。
 * 业务命令（login/new-game/status/...）会在对应 API 建立后接入。
 */

import { parseArgs } from "node:util";

type Output = Record<string, unknown>;

const options = {
  base: { type: "string" },
  token: { type: "string" },
  timeout: { type: "string" },
  method: { type: "string" },
  path: { type: "string" },
  body: { type: "string" },
  header: { type: "string", multiple: true },
} as const;

function emit(payload: Output, exitCode = 0): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

function fail(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-api] ${message}`);
  emit({ ok: false, action, error: message }, 1);
}

function usage(): void {
  emit({
    ok: true,
    usage: [
      "AGENT_API_BASE_URL=http://127.0.0.1:<port> agent-api health",
      "AGENT_API_BASE_URL=http://127.0.0.1:<port> agent-api openapi",
      "AGENT_API_BASE_URL=http://127.0.0.1:<port> agent-api request --method GET --path /api/v1/health",
      "agent-api request --method POST --path /api/v1/... --body '<json>' [--header 'k: v']",
    ],
  });
}

function baseUrl(value: string | undefined): string {
  const raw = value ?? process.env.AGENT_API_BASE_URL;
  if (!raw) {
    throw new Error("缺少服务端地址：传 --base 或设置 AGENT_API_BASE_URL");
  }
  const url = new URL(raw);
  return url.toString().replace(/\/+$/, "");
}

function parseHeaders(values: readonly string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const raw of values ?? []) {
    const index = raw.indexOf(":");
    if (index <= 0) {
      throw new Error(`非法 header: ${raw}`);
    }
    headers[raw.slice(0, index).trim()] = raw.slice(index + 1).trim();
  }
  return headers;
}

function parseBody(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  JSON.parse(raw);
  return raw;
}

async function request(
  action: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  body?: string,
): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let result: unknown = text;
  try {
    result = JSON.parse(text);
  } catch {
    // 非 JSON 响应原样返回，便于排查代理 / 网关错误。
  }
  emit(
    {
      ok: response.ok,
      action,
      status: response.status,
      result,
    },
    response.ok ? 0 : 1,
  );
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options,
  });
  const command = parsed.positionals[0];
  const values = parsed.values;

  if (!command) {
    usage();
    return;
  }

  const base = baseUrl(typeof values.base === "string" ? values.base : undefined);
  const headers = parseHeaders(values.header as string[] | undefined);
  const token = typeof values.token === "string" ? values.token : process.env.AGENT_API_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const timeoutMs = Number(values.timeout ?? 10_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout 必须为正数（毫秒）");
  }

  if (command === "health") {
    await request("health", "GET", `${base}/api/v1/health`, headers, timeoutMs);
    return;
  }

  if (command === "openapi") {
    const response = await fetch(`${base}/openapi.json`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let spec: unknown = text;
    try {
      spec = JSON.parse(text);
    } catch {
      // 保持原样。
    }
    const record =
      typeof spec === "object" && spec !== null ? (spec as Record<string, unknown>) : {};
    const paths = typeof record.paths === "object" && record.paths !== null ? record.paths : {};
    emit(
      {
        ok: response.ok,
        action: "openapi",
        status: response.status,
        info: record.info,
        paths: Object.keys(paths),
      },
      response.ok ? 0 : 1,
    );
    return;
  }

  if (command === "request") {
    if (typeof values.path !== "string") {
      throw new Error("request 需要 --path");
    }
    if (!values.path.startsWith("http") && !values.path.startsWith("/")) {
      throw new Error("--path 必须是绝对路径或完整 URL");
    }
    const method = (typeof values.method === "string" ? values.method : "GET").toUpperCase();
    const url = values.path.startsWith("http") ? values.path : `${base}${values.path}`;
    await request(
      "request",
      method,
      url,
      headers,
      timeoutMs,
      parseBody(typeof values.body === "string" ? values.body : undefined),
    );
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

main().catch((error: unknown) => fail("agent-api", error));
