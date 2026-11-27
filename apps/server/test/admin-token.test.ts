/**
 * 后台口令：配了 `ADMIN_TOKEN` 之后，运维身份还要多带一个 `x-admin-token`。
 *
 * 这一层不是登录，是「后台能走局域网」的代价：没有它，知道用户名 `admin` 的人就是运维。
 * 只约束运维身份——玩家端照旧只带 `Authorization`。
 */

import { DEFAULT_SERVER_PORT } from "@ai-trpg/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { buildApp } from "../src/app";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import type { Env } from "../src/env";
import { ADMIN_USER, DEMO_USER } from "../src/identity";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const TOKEN = "test-admin-token";

const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: DEFAULT_SERVER_PORT,
  CORS_ORIGINS: "*",
  ADMIN_TOKEN: TOKEN,
  LOG_LEVEL: "silent",
};

describe.skipIf(!testDatabaseUrl)("后台口令", () => {
  let handle: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildApp>>;

  const asAdmin = { authorization: `Bearer ${ADMIN_USER.username}` };
  const asPlayer = { authorization: `Bearer ${DEMO_USER.username}` };

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
    app = await buildApp({ env: testEnv, logger: false, db: () => handle.db });
  });

  afterAll(async () => {
    if (handle) {
      await handle.pool.end();
    }
    if (app) {
      await app.close();
    }
  });

  const status = (headers: Record<string, string>) =>
    app.inject({ method: "GET", url: "/api/v1/status", headers });

  it("运维没带口令：401，并说明该配哪个变量", async () => {
    const response = await status(asAdmin);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized" });
    expect(String(response.json().message)).toContain("VITE_ADMIN_TOKEN");
  });

  it("口令不对：401", async () => {
    const response = await status({ ...asAdmin, "x-admin-token": "not-the-token" });
    expect(response.statusCode).toBe(401);
    expect(String(response.json().message)).toContain("不一致");
  });

  it("口令对：运维照常读到机器级读数", async () => {
    const response = await status({ ...asAdmin, "x-admin-token": TOKEN });
    expect(response.statusCode).toBe(200);
  });

  it("玩家身份不受影响：口令只管运维", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/games",
      headers: asPlayer,
    });
    expect(response.statusCode).toBe(200);
  });
});
