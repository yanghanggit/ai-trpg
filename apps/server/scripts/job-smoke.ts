/**
 * 后台作业队列冒烟测试（脱离 HTTP / 业务代码）。
 *
 * 只使用 `TEST_DATABASE_URL`；在脚本内临时注册测试作业，并为本次运行生成独立
 * queue 前缀，结束时清理这些作业。覆盖：成功、重试、最终失败、不可重试、
 * 未注册 kind、串行键冲突、等待超时、失联回收与 start/stop 常驻循环。
 *
 *   pnpm smoke:jobs
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { like } from "drizzle-orm";
import { z } from "zod";
import { openDatabase } from "../src/db/connect";
import { runMigrations } from "../src/db/migrate";
import { jobs } from "../src/db/schema";
import {
  defineJob,
  enqueueJob,
  JobFailedError,
  JobNotFoundError,
  JobRegistry,
  JobSerializationConflictError,
  JobStore,
  JobTimeoutError,
  JobWorker,
  NonRetryableJobError,
  waitForJob,
} from "../src/jobs";
import { silentLogger } from "../src/logging";

const BASE_QUEUE = `smoke-jobs-${Date.now()}-${randomUUID().slice(0, 8)}`;

type ScenarioResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const results: ScenarioResult[] = [];

function queueFor(name: string): string {
  return `${BASE_QUEUE}:${name}`;
}

async function scenario(name: string, run: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (error) {
    results.push({
      name,
      ok: false,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

async function main(): Promise<void> {
  const handle = openDatabase("TEST_DATABASE_URL");
  const store = new JobStore(handle.db);

  const failOnceAttempts = new Map<string, number>();

  const echo = defineJob({
    name: "smoke.echo",
    payload: z.object({ value: z.string() }),
    run: ({ value }) => ({ echo: value }),
  });
  const failOnce = defineJob({
    name: "smoke.fail-once",
    payload: z.object({}),
    run: (_payload, context) => {
      const attempt = (failOnceAttempts.get(context.jobId) ?? 0) + 1;
      failOnceAttempts.set(context.jobId, attempt);
      if (attempt === 1) {
        throw new Error("first attempt failed");
      }
      return { attempts: attempt };
    },
    maxAttempts: 2,
  });
  const alwaysFail = defineJob({
    name: "smoke.always-fail",
    payload: z.object({}),
    run: () => {
      throw new Error("always fail");
    },
    maxAttempts: 2,
  });
  const nonRetryable = defineJob({
    name: "smoke.non-retryable",
    payload: z.object({}),
    run: () => {
      throw new NonRetryableJobError("do not retry");
    },
    maxAttempts: 5,
  });

  const registry = new JobRegistry();
  registry.register(echo);
  registry.register(failOnce);
  registry.register(alwaysFail);
  registry.register(nonRetryable);

  function makeWorker(queue: string): JobWorker {
    return new JobWorker({
      store,
      registry,
      queues: [queue],
      staleAfterMs: 0,
      pollIntervalMs: 20,
      retryDelayMs: () => 0,
      logger: silentLogger,
    });
  }

  async function cleanup(): Promise<void> {
    await handle.db.delete(jobs).where(like(jobs.queue, `${BASE_QUEUE}%`));
  }

  await runMigrations(handle.db);
  await cleanup();

  try {
    await scenario("成功执行并保存结果", async () => {
      const queue = queueFor("echo");
      const queued = await enqueueJob(store, echo, { value: "hello" }, { queue });
      const claimed = await makeWorker(queue).runOnce();
      assert.equal(claimed, 1);

      const record = await store.getRecord(queued.jobId);
      assert.equal(record?.status, "succeeded");
      assert.deepEqual(record?.result, { echo: "hello" });

      const waited = await waitForJob(store, queued.jobId, {
        timeoutMs: 1_000,
        pollIntervalMs: 20,
      });
      assert.equal(waited.status, "succeeded");
      return "status=succeeded, result={echo:hello}";
    });

    await scenario("失败一次后重试成功", async () => {
      const queue = queueFor("retry");
      const queued = await enqueueJob(store, failOnce, {}, { queue });
      const worker = makeWorker(queue);

      await worker.runOnce();
      let record = await store.getRecord(queued.jobId);
      assert.equal(record?.status, "pending");
      assert.equal(record?.attempts, 1);

      await worker.runOnce();
      record = await store.getRecord(queued.jobId);
      assert.equal(record?.status, "succeeded");
      assert.equal(record?.attempts, 2);
      assert.deepEqual(record?.result, { attempts: 2 });
      return "attempts=2, status=succeeded";
    });

    await scenario("重试耗尽后最终失败", async () => {
      const queue = queueFor("fail");
      const queued = await enqueueJob(store, alwaysFail, {}, { queue });
      const worker = makeWorker(queue);

      await worker.runOnce();
      await worker.runOnce();
      const record = await store.getRecord(queued.jobId);
      assert.equal(record?.status, "failed");
      assert.equal(record?.attempts, 2);
      assert.match(record?.error ?? "", /always fail/);

      await assert.rejects(
        waitForJob(store, queued.jobId, { timeoutMs: 1_000 }),
        (error: unknown) => error instanceof JobFailedError,
      );
      return "attempts=2, status=failed";
    });

    await scenario("不可重试错误立即失败", async () => {
      const queue = queueFor("non-retry");
      const queued = await enqueueJob(store, nonRetryable, {}, { queue });
      await makeWorker(queue).runOnce();

      const record = await store.getRecord(queued.jobId);
      assert.equal(record?.status, "failed");
      assert.equal(record?.attempts, 1);
      assert.match(record?.error ?? "", /do not retry/);
      return "attempts=1, status=failed";
    });

    await scenario("未注册 kind 失败而不是静默跳过", async () => {
      const queue = queueFor("unknown");
      const queued = await store.enqueue({
        kind: "smoke.missing",
        payload: {},
        queue,
        maxAttempts: 3,
      });
      await makeWorker(queue).runOnce();

      const record = await store.getRecord(queued.jobId);
      assert.equal(record?.status, "failed");
      assert.equal(record?.attempts, 1);
      assert.match(record?.error ?? "", /未注册/);
      return "status=failed, error=未注册";
    });

    await scenario("串行键阻止重复活跃作业", async () => {
      const queue = queueFor("serial");
      const first = await enqueueJob(
        store,
        echo,
        { value: "first" },
        { queue, serializationKey: "same-room" },
      );

      await assert.rejects(
        enqueueJob(store, echo, { value: "second" }, { queue, serializationKey: "same-room" }),
        (error: unknown) =>
          error instanceof JobSerializationConflictError && error.existingJobId === first.jobId,
      );

      const claimed = await store.claimNext({ queues: [queue], workerId: "smoke-serial" });
      assert.equal(claimed?.jobId, first.jobId);
      await store.complete(first.jobId, "smoke-serial", { ok: true });

      const next = await enqueueJob(
        store,
        echo,
        { value: "third" },
        { queue, serializationKey: "same-room" },
      );
      assert.notEqual(next.jobId, first.jobId);
      return "conflict typed, terminal state releases key";
    });

    await scenario("等待超时与不存在", async () => {
      const queue = queueFor("timeout");
      const queued = await enqueueJob(store, echo, { value: "pending" }, { queue });

      await assert.rejects(
        waitForJob(store, queued.jobId, { timeoutMs: 80, pollIntervalMs: 10 }),
        (error: unknown) => error instanceof JobTimeoutError,
      );
      await assert.rejects(
        waitForJob(store, randomUUID(), { timeoutMs: 80, pollIntervalMs: 10 }),
        (error: unknown) => error instanceof JobNotFoundError,
      );
      return "timeout / not-found typed";
    });

    await scenario("失联 worker 的作业可被回收", async () => {
      const queue = queueFor("stale");
      const queued = await enqueueJob(store, echo, { value: "stale" }, { queue, maxAttempts: 2 });
      await store.claimNext({ queues: [queue], workerId: "smoke-lost-worker" });

      const reclaimed = await store.reclaimStale(new Date(Date.now() + 1_000));
      assert.deepEqual(reclaimed, [queued.jobId]);

      const record = await store.getRecord(queued.jobId);
      assert.equal(record?.status, "pending");
      assert.equal(record?.attempts, 1);
      assert.match(record?.error ?? "", /租约失效/);
      return "status=pending, attempts=1";
    });

    await scenario("常驻 worker 启停并执行作业", async () => {
      const queue = queueFor("loop");
      const queued = await enqueueJob(store, echo, { value: "loop" }, { queue });
      const worker = makeWorker(queue);
      const started = worker.start();

      try {
        const waited = await waitForJob(store, queued.jobId, {
          timeoutMs: 2_000,
          pollIntervalMs: 20,
        });
        assert.equal(waited.status, "succeeded");
      } finally {
        await worker.stop();
        await started;
      }

      assert.equal(worker.running, 0);
      return "start -> succeeded -> stop";
    });
  } finally {
    await cleanup();
    await handle.pool.end();
  }

  const failed = results.filter((result) => !result.ok);
  const payload = {
    ok: failed.length === 0,
    database: "TEST_DATABASE_URL",
    queuePrefix: BASE_QUEUE,
    total: results.length,
    failed: failed.length,
    results,
  };

  console.log(JSON.stringify(payload, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exitCode = 1;
});
