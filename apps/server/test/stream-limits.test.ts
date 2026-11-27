/**
 * SSE 的三条上限：每身份并发数、单流寿命、积压断开。
 *
 * 前两条走真 HTTP（hijack 之后的写入口只有真连接才看得见），第三条走单元测试——
 * 「积压到多少字节」由内核缓冲决定，造不出来，但判定函数本身是纯的。
 *
 * 需要 TEST_DATABASE_URL；未配置时跳过整组集成用例。
 */

import { DEFAULT_SERVER_PORT } from "@ai-trpg/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { buildApp } from "../src/app";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { games } from "../src/db/schema";
import type { Env } from "../src/env";
import { DEMO_USER } from "../src/identity";
import { JobChangeBroker } from "../src/jobs";
import { createStreamRegistry, isOverloaded } from "../src/routes/stream-limits";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const SLUG = `stream-limit-${Date.now()}`;

const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: DEFAULT_SERVER_PORT,
  CORS_ORIGINS: "*",
  LOG_LEVEL: "silent",
};

describe("连接登记簿", () => {
  it("按身份算额度，到顶就拒，释放后能再拿", () => {
    const registry = createStreamRegistry({ maxPerUser: 2 });
    const first = registry.open("demo");
    const second = registry.open("demo");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(registry.open("demo")).toBeUndefined();
    expect(registry.active()).toBe(2);

    // 别的身份不受影响：额度是按人算的，不是全局。
    expect(registry.open("admin")).toBeDefined();
    expect(registry.active()).toBe(3);

    first?.release();
    expect(registry.active()).toBe(2);
    expect(registry.open("demo")).toBeDefined();
  });

  it("release 幂等：重复调用不会把别人的额度减掉", () => {
    const registry = createStreamRegistry({ maxPerUser: 5 });
    const lease = registry.open("demo");
    registry.open("demo");
    lease?.release();
    lease?.release();
    lease?.release();
    expect(registry.active()).toBe(1);
  });
});

describe("积压判定", () => {
  it("超过预算才算慢消费者：等号不断", () => {
    expect(isOverloaded(999, 1_000)).toBe(false);
    expect(isOverloaded(1_000, 1_000)).toBe(false);
    expect(isOverloaded(1_001, 1_000)).toBe(true);
  });
});

describe.skipIf(!testDatabaseUrl)("作业状态流的上限", () => {
  let handle: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let broker: JobChangeBroker;
  let base: string;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);

    broker = new JobChangeBroker({
      databaseUrl: testDatabaseUrl as string,
      reconnectDelayMs: () => 100,
    });
    broker.start();
    // 上限调到能一眼看出来的量级：1 条、200ms 寿命。
    app = await buildApp({
      env: testEnv,
      logger: false,
      db: () => handle.db,
      broker,
      streamLimits: { maxPerUser: 1, lifetimeMs: 200 },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("服务端没有监听端口");
    }
    base = `http://127.0.0.1:${address.port}/api/v1`;

    const created = await fetch(`${base}/games`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${DEMO_USER.username}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ seed: "dark-fantasy:crow-grave", slug: SLUG }),
    });
    expect(created.status).toBe(200);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (broker) {
      await broker.stop();
    }
    if (handle) {
      await handle.db.delete(games).where(eq(games.slug, SLUG));
      await handle.pool.end();
    }
  });

  const streamUrl = () => `${base}/games/${SLUG}/jobs/stream?token=${DEMO_USER.username}`;

  it("同一身份挂着一条时，第二条回 429；收掉之后又能连上", async () => {
    const first = await fetch(streamUrl(), { headers: { accept: "text/event-stream" } });
    expect(first.status).toBe(200);
    const reader = first.body?.getReader();
    expect(reader).toBeDefined();

    const rejected = await fetch(streamUrl(), { headers: { accept: "text/event-stream" } });
    expect(rejected.status).toBe(429);
    expect((await rejected.json()) as { error: string }).toMatchObject({
      error: "too_many_streams",
    });

    await reader?.cancel();
    // 断开是异步的：让事件循环跑一轮再连。
    await new Promise((resolve) => setTimeout(resolve, 50));

    const again = await fetch(streamUrl(), { headers: { accept: "text/event-stream" } });
    expect(again.status).toBe(200);
    await again.body?.cancel();
  });

  it("寿命到点主动收尾：先发 close，再挂断", async () => {
    const response = await fetch(streamUrl(), { headers: { accept: "text/event-stream" } });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const chunk = await (reader as ReadableStreamDefaultReader<Uint8Array>).read();
      if (chunk.done === true) {
        break;
      }
      text += decoder.decode(chunk.value, { stream: true });
      if (text.includes("event: close")) {
        break;
      }
    }

    expect(text).toContain("retry: 3000");
    expect(text).toContain("event: close");
    expect(text).toContain('"reason":"lifetime"');
  }, 15_000);
});
