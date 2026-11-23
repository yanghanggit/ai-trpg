/**
 * 业务 API 的骨架守卫：身份、建局、接管、提交动作与事件流。
 *
 * 只覆盖传输层：参数形状、错误码与「动作真的落了事件」。玩法结果由 `game` 的用例负责。
 * 需要 TEST_DATABASE_URL；未配置时整组跳过。
 */

import { DEFAULT_SERVER_PORT } from "@ai-trpg/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { buildApp } from "../src/app";
import type { DatabaseHandle } from "../src/db/connect";
import { openDatabase } from "../src/db/connect";
import { DEMO_USER } from "../src/db/demo-fixture";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { games } from "../src/db/schema";
import type { Env } from "../src/env";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const SLUG = `api-test-${Date.now()}`;

const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: DEFAULT_SERVER_PORT,
  CORS_ORIGINS: "*",
  LOG_LEVEL: "silent",
};

describe.skipIf(!testDatabaseUrl)("业务 API", () => {
  let handle: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildApp>>;

  const auth = { authorization: `Bearer ${DEMO_USER.username}` };

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
    app = await buildApp({ env: testEnv, logger: false, db: () => handle.db });
  });

  afterAll(async () => {
    if (handle) {
      await handle.db.delete(games).where(eq(games.slug, SLUG));
      await handle.pool.end();
    }
    if (app) {
      await app.close();
    }
  });

  it("缺少令牌返回 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("未知用户返回 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: "Bearer nobody" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("令牌解析出身份", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { username: DEMO_USER.username } });
  });

  it("建局、读状态、接管、提交动作、读事件流", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/games",
      headers: auth,
      payload: { seed: "dark-fantasy:crow-grave", slug: SLUG },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ state: { game: { slug: SLUG, version: 0 } } });

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}`,
      headers: auth,
    });
    expect(status.statusCode).toBe(200);

    const stageMap = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}/stage-map`,
      headers: auth,
    });
    expect(stageMap.json()).toMatchObject({ stages: { 鸦葬岗: expect.any(Array) } });

    const control = await app.inject({
      method: "POST",
      url: `/api/v1/games/${SLUG}/actors/拾骨人伊莱/control`,
      headers: auth,
      payload: {},
    });
    expect(control.statusCode).toBe(200);
    expect(control.json()).toMatchObject({ result: { controllerType: "player" } });

    // wait 不调模型：这条用例只验证「HTTP → 服务层 → 事件流」这条链路。
    const action = await app.inject({
      method: "POST",
      url: `/api/v1/games/${SLUG}/actors/拾骨人伊莱/actions`,
      headers: auth,
      payload: { kind: "wait" },
    });
    expect(action.statusCode).toBe(200);
    expect(action.json()).toMatchObject({ plan: { actions: [{ kind: "wait" }] } });

    const messages = await app.inject({
      method: "GET",
      url: `/api/v1/games/${SLUG}/messages`,
      headers: auth,
    });
    expect(messages.statusCode).toBe(200);
    expect(messages.json()).toMatchObject({ messageCursor: expect.any(Number) });
    expect((messages.json() as { messages: unknown[] }).messages.length).toBeGreaterThan(0);
  });

  it("动作参数组合错误在服务端也被拦下", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/games/${SLUG}/actors/拾骨人伊莱/actions`,
      headers: auth,
      payload: { kind: "use", item: "拾骨钩" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("不存在的局返回 404 而不是 500", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/games/no-such-game",
      headers: auth,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });

  it("OpenAPI 收录动作与轨迹端点", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const paths = response.json().paths as Record<string, unknown>;
    expect(Object.keys(paths)).toContain("/api/v1/games/{game}/actors/{actor}/actions");
    expect(Object.keys(paths)).toContain("/api/v1/games/{game}/turns/world");
    expect(Object.keys(paths)).toContain("/api/v1/traces");
  });
});
