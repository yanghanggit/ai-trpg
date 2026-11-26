/**
 * 作业状态推送（SSE）的守卫：入队与完成都要被推出来，补发要能补上错过的终态。
 *
 * 走真 HTTP + 真 `LISTEN/NOTIFY`：这个基建的要点就是「跨进程也成立」，
 * 用 `inject` 或进程内事件测不到。需要 TEST_DATABASE_URL；未配置时整组跳过。
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
import { TURN_JOB, TURN_QUEUE, turnSerializationKey } from "../src/game-ops";
import { DEMO_USER } from "../src/identity";
import { JobChangeBroker, JobStore, parseJobChange } from "../src/jobs";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const SLUG = `job-stream-${Date.now()}`;

const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: DEFAULT_SERVER_PORT,
  CORS_ORIGINS: "*",
  LOG_LEVEL: "silent",
};

type Frame = { id: string | null; event: string; data: string };

/** 从流里读够 n 条 `event: job`，或到死线为止。 */
async function readJobFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<Frame[]> {
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = "";
  const deadline = Date.now() + 10_000;
  while (frames.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`等作业事件超时：已收到 ${frames.length}/${count} 条`);
    }
    const chunk = await reader.read();
    if (chunk.done === true) {
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      let id: string | null = null;
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) {
          continue;
        }
        if (line.startsWith("id:")) {
          id = line.slice(3).trim();
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).trim());
        }
      }
      if (event === "job") {
        frames.push({ id, event, data: data.join("\n") });
      }
    }
  }
  return frames;
}

describe.skipIf(!testDatabaseUrl)("作业状态流（SSE）", () => {
  let handle: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let broker: JobChangeBroker;
  let base: string;
  let gameId = "";
  let store: JobStore;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    await resetDomainData(handle.db);
    await seedDemoData(handle.db);
    store = new JobStore(handle.db);

    broker = new JobChangeBroker({
      databaseUrl: testDatabaseUrl as string,
      reconnectDelayMs: () => 100,
    });
    broker.start();
    app = await buildApp({ env: testEnv, logger: false, db: () => handle.db, broker });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("服务端没有监听端口");
    }
    base = `http://127.0.0.1:${address.port}/api/v1`;
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

  it("把入队与终态推给订阅者，并带上可直接回传的游标", async () => {
    const created = await fetch(`${base}/games`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${DEMO_USER.username}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ seed: "dark-fantasy:crow-grave", slug: SLUG }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { view: { game: { id: string } } };
    gameId = createdBody.view.game.id;

    // 浏览器拿不到自定义头：这条流允许把开发期身份放进查询串。
    const response = await fetch(`${base}/games/${SLUG}/jobs/stream?token=${DEMO_USER.username}`, {
      headers: { accept: "text/event-stream" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).not.toBeNull();
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    // 入队一条作业：订阅方应当立刻收到 pending。
    const job = await store.enqueue({
      kind: TURN_JOB.actorPlayer,
      payload: { gameId, actorName: "无名旅人", action: { kind: "wait" } },
      queue: TURN_QUEUE,
      serializationKey: turnSerializationKey(gameId),
    });

    const first = (await readJobFrames(reader as ReadableStreamDefaultReader<Uint8Array>, 1))[0];
    expect(first).toBeDefined();
    const firstJob = JSON.parse(first?.data ?? "{}").job as {
      jobId: string;
      status: string;
      progress: unknown;
    };
    expect(firstJob).toMatchObject({ jobId: job.jobId, status: "pending", progress: null });
    // 事件的 id 就是那一行的 updatedAt，客户端下次重连可以直接拿它当 since。
    expect(first?.id).toBe(job.updatedAt.toISOString());

    const stream = reader as ReadableStreamDefaultReader<Uint8Array>;
    const nextJob = async () => {
      const [frame] = await readJobFrames(stream, 1);
      return JSON.parse(frame?.data ?? "{}").job as {
        jobId: string;
        status: string;
        progress: { step: string } | null;
      };
    };

    // 领取 → 报进度 → 完成：每一步都是同一行的一次变更，各推一条。
    // 每步之间留一点间隔，模拟真实回合（推送读的是那一刻的行，同毫秒的多步会合并成最终态）。
    const claimed = await store.claimNext({ queues: [TURN_QUEUE], workerId: "test-worker" });
    expect(claimed?.jobId).toBe(job.jobId);
    expect(await nextJob()).toMatchObject({ status: "running", progress: null });

    await store.setProgress(job.jobId, "test-worker", { step: "applying" });
    expect(await nextJob()).toMatchObject({ status: "running", progress: { step: "applying" } });

    await store.complete(job.jobId, "test-worker", { ok: true });
    expect(await nextJob()).toMatchObject({ status: "succeeded" });

    await reader?.cancel();
  }, 30_000);

  it("给了 since 就补发那之后的终态，并忽略别局的作业", async () => {
    // 上一条已经 succeeded：从它之前一点开始补，应该能拿到终态。
    const [existing] = await store.list({ serializationKey: turnSerializationKey(gameId) });
    expect(existing).toBeDefined();
    const since = new Date((existing?.updatedAt.getTime() ?? 0) - 60_000).toISOString();

    const response = await fetch(
      `${base}/games/${SLUG}/jobs/stream?token=${DEMO_USER.username}&since=${encodeURIComponent(since)}`,
      { headers: { accept: "text/event-stream" } },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    const frames = await readJobFrames(reader as ReadableStreamDefaultReader<Uint8Array>, 1);
    const replayed = JSON.parse(frames[0]?.data ?? "{}").job as { jobId: string; status: string };
    expect(replayed).toMatchObject({ jobId: existing?.jobId, status: "succeeded" });
    await reader?.cancel();
  }, 30_000);

  it("没有订阅源时回 503，别局与陌生令牌都不放行", async () => {
    const appWithoutBroker = await buildApp({ env: testEnv, logger: false, db: () => handle.db });
    try {
      const unauthorized = await appWithoutBroker.inject({
        method: "GET",
        url: `/api/v1/games/${SLUG}/jobs/stream`,
      });
      expect(unauthorized.statusCode).toBe(401);

      const noBroker = await appWithoutBroker.inject({
        method: "GET",
        url: `/api/v1/games/${SLUG}/jobs/stream`,
        headers: { authorization: `Bearer ${DEMO_USER.username}` },
      });
      expect(noBroker.statusCode).toBe(503);
    } finally {
      await appWithoutBroker.close();
    }
  });
});

describe("作业通知载荷", () => {
  it("解析不了就当没有：推送丢了只是晚一拍，不该让订阅循环崩掉", () => {
    expect(parseJobChange("not json")).toBeNull();
    expect(parseJobChange(JSON.stringify({ jobId: "x" }))).toBeNull();
    expect(
      parseJobChange(
        JSON.stringify({
          jobId: "job-1",
          queue: "turns",
          kind: TURN_JOB.stage,
          serializationKey: "turn:g",
          status: "running",
        }),
      ),
    ).toEqual({
      jobId: "job-1",
      queue: "turns",
      kind: TURN_JOB.stage,
      serializationKey: "turn:g",
      status: "running",
    });
  });
});
