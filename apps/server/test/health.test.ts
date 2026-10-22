import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT, SERVICE_NAME, webBaseUrl } from "@ai-trpg/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { Env } from "../src/env";

const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: DEFAULT_SERVER_PORT,
  CORS_ORIGINS: webBaseUrl(DEFAULT_WEB_PORT),
  LOG_LEVEL: "silent",
};

describe("HTTP 骨架", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ env: testEnv, logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/health 返回服务状态", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: SERVICE_NAME,
      apiVersion: "v1",
    });
    expect(typeof response.json().uptimeSeconds).toBe("number");
    expect(typeof response.json().serverTime).toBe("string");
  });

  it("GET /openapi.json 导出健康检查契约", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });

    expect(response.statusCode).toBe(200);
    const paths = response.json().paths as Record<string, unknown>;
    expect(Object.keys(paths)).toContain("/api/v1/health");
  });

  it("未知路由返回结构化 404", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });
});
