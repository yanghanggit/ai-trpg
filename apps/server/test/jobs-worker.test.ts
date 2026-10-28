import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { runMigrations } from "../src/db/migrate";
import { jobs } from "../src/db/schema";
import {
  defineJob,
  enqueueJob,
  type JobContext,
  JobFailedError,
  JobNotFoundError,
  JobRegistry,
  JobStore,
  JobTimeoutError,
  JobWorker,
  NonRetryableJobError,
  waitForJob,
} from "../src/jobs";
import { silentLogger } from "../src/logging";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("JobWorker", () => {
  let handle: DatabaseHandle;
  let store: JobStore;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
    store = new JobStore(handle.db);
  });

  beforeEach(async () => {
    await handle.db.delete(jobs);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  function makeWorker(registry: JobRegistry, options: { retryDelayMs?: () => number } = {}) {
    return new JobWorker({
      store,
      registry,
      staleAfterMs: 0,
      pollIntervalMs: 20,
      logger: silentLogger,
      ...(options.retryDelayMs ? { retryDelayMs: options.retryDelayMs } : {}),
    });
  }

  it("executes a registered job and stores its result", async () => {
    const registry = new JobRegistry();
    const contexts: JobContext[] = [];
    const echo = defineJob({
      name: "test.echo",
      payload: z.object({ value: z.string() }),
      run: async ({ value }, context) => {
        contexts.push(context);
        return { echo: value };
      },
    });
    registry.register(echo);

    const queued = await enqueueJob(store, echo, { value: "hello" });
    const worker = makeWorker(registry);

    expect(await worker.runOnce()).toBe(1);
    const record = await store.getRecord(queued.jobId);
    expect(record).toMatchObject({
      status: "succeeded",
      attempts: 1,
      result: { echo: "hello" },
      error: null,
    });
    expect(contexts[0]).toMatchObject({
      jobId: queued.jobId,
      kind: "test.echo",
      attempt: 1,
      maxAttempts: 1,
    });
  });

  it("retries a failing job and then marks it failed", async () => {
    const registry = new JobRegistry();
    const failing = defineJob({
      name: "test.fail",
      payload: z.object({}),
      run: () => {
        throw new Error("boom");
      },
      maxAttempts: 2,
    });
    registry.register(failing);

    const queued = await enqueueJob(store, failing, {});
    const worker = makeWorker(registry, { retryDelayMs: () => 0 });

    await worker.runOnce();
    expect(await store.getRecord(queued.jobId)).toMatchObject({
      status: "pending",
      attempts: 1,
      error: expect.stringContaining("boom"),
    });

    await worker.runOnce();
    expect(await store.getRecord(queued.jobId)).toMatchObject({
      status: "failed",
      attempts: 2,
      error: expect.stringContaining("boom"),
    });
  });

  it("does not retry NonRetryableJobError", async () => {
    const registry = new JobRegistry();
    const nonRetryable = defineJob({
      name: "test.non-retryable",
      payload: z.object({}),
      run: () => {
        throw new NonRetryableJobError("stop");
      },
      maxAttempts: 5,
    });
    registry.register(nonRetryable);

    const queued = await enqueueJob(store, nonRetryable, {});
    await makeWorker(registry).runOnce();
    expect(await store.getRecord(queued.jobId)).toMatchObject({
      status: "failed",
      attempts: 1,
      error: expect.stringContaining("stop"),
    });
  });

  it("fails unregistered jobs and invalid payloads without retrying", async () => {
    const registry = new JobRegistry();
    const unknown = await store.enqueue({
      kind: "test.missing",
      payload: {},
      queue: "default",
    });
    await makeWorker(registry).runOnce();
    expect(await store.getRecord(unknown.jobId)).toMatchObject({
      status: "failed",
      attempts: 1,
      error: expect.stringContaining("未注册"),
    });

    const echo = defineJob({
      name: "test.echo",
      payload: z.object({ value: z.string() }),
      run: ({ value }) => value,
    });
    registry.register(echo);
    const invalid = await store.enqueue({
      kind: "test.echo",
      payload: { value: 1 },
      maxAttempts: 3,
    });
    await makeWorker(registry).runOnce();
    expect(await store.getRecord(invalid.jobId)).toMatchObject({
      status: "failed",
      attempts: 1,
      error: expect.stringContaining("payload"),
    });
  });

  it("waits for success, failure, timeout and missing jobs", async () => {
    const registry = new JobRegistry();
    const echo = defineJob({
      name: "test.echo",
      payload: z.object({ value: z.string() }),
      run: ({ value }) => value,
    });
    const failing = defineJob({
      name: "test.fail",
      payload: z.object({}),
      run: () => {
        throw new Error("failed");
      },
    });
    registry.register(echo);
    registry.register(failing);

    const done = await enqueueJob(store, echo, { value: "ok" });
    await makeWorker(registry).runOnce();
    expect((await waitForJob(store, done.jobId)).status).toBe("succeeded");

    const failed = await enqueueJob(store, failing, {});
    await makeWorker(registry).runOnce();
    await expect(waitForJob(store, failed.jobId)).rejects.toBeInstanceOf(JobFailedError);

    const pending = await enqueueJob(store, echo, { value: "pending" });
    await expect(
      waitForJob(store, pending.jobId, { timeoutMs: 30, pollIntervalMs: 10 }),
    ).rejects.toBeInstanceOf(JobTimeoutError);

    await expect(waitForJob(store, "missing", { timeoutMs: 30 })).rejects.toBeInstanceOf(
      JobNotFoundError,
    );
  });

  it("starts, executes, and stops cleanly", async () => {
    const registry = new JobRegistry();
    const echo = defineJob({
      name: "test.echo",
      payload: z.object({ value: z.string() }),
      run: ({ value }) => value,
    });
    registry.register(echo);

    const queued = await enqueueJob(store, echo, { value: "loop" });
    const worker = makeWorker(registry);
    const started = worker.start();

    let status: string | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = (await store.get(queued.jobId))?.status;
      if (status === "succeeded") {
        break;
      }
      await delay(20);
    }
    expect(status).toBe("succeeded");

    await worker.stop();
    await started;
    expect(worker.running).toBe(0);
  });
});
