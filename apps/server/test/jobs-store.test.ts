import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { runMigrations } from "../src/db/migrate";
import { jobs } from "../src/db/schema";
import { JobSerializationConflictError, JobStore } from "../src/jobs";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("JobStore", () => {
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

  it("enqueues, reads and lists jobs", async () => {
    const snapshot = await store.enqueue({
      kind: "test.echo",
      payload: { value: "hello" },
      queue: "test-queue",
      serializationKey: "key-a",
      maxAttempts: 3,
    });

    expect(snapshot).toMatchObject({
      kind: "test.echo",
      queue: "test-queue",
      status: "pending",
      serializationKey: "key-a",
      attempts: 0,
      maxAttempts: 3,
      error: null,
    });

    expect(await store.get(snapshot.jobId)).toMatchObject({ jobId: snapshot.jobId });
    expect(await store.list({ queue: "test-queue" })).toHaveLength(1);
    expect(await store.list({ kind: "missing" })).toHaveLength(0);
    expect(await store.countByStatus()).toMatchObject({ pending: 1, running: 0 });
  });

  it("enforces one active job per serialization key", async () => {
    const first = await store.enqueue({
      kind: "test.echo",
      payload: {},
      queue: "serial",
      serializationKey: "room:1",
    });

    await expect(
      store.enqueue({
        kind: "test.echo",
        payload: {},
        queue: "serial",
        serializationKey: "room:1",
      }),
    ).rejects.toMatchObject({
      name: "JobSerializationConflictError",
      existingJobId: first.jobId,
    });

    const claimed = await store.claimNext({ queues: ["serial"], workerId: "w1" });
    expect(claimed?.jobId).toBe(first.jobId);
    await store.complete(first.jobId, "w1", { ok: true });

    const next = await store.enqueue({
      kind: "test.echo",
      payload: {},
      queue: "serial",
      serializationKey: "room:1",
    });
    expect(next.jobId).not.toBe(first.jobId);
  });

  it("claims with FOR UPDATE SKIP LOCKED and guards the worker lease", async () => {
    const snapshot = await store.enqueue({ kind: "test.echo", payload: {}, queue: "claim" });
    const claimed = await store.claimNext({ queues: ["claim"], workerId: "w1" });

    expect(claimed).toMatchObject({
      jobId: snapshot.jobId,
      status: "running",
      attempts: 1,
      lockedBy: "w1",
    });
    expect(claimed?.startedAt).toBeInstanceOf(Date);
    expect(await store.claimNext({ queues: ["claim"], workerId: "w2" })).toBeNull();

    expect(await store.complete(snapshot.jobId, "w2", { wrong: true })).toBe(false);
    expect(await store.complete(snapshot.jobId, "w1", { ok: true })).toBe(true);
    expect(await store.get(snapshot.jobId)).toMatchObject({
      status: "succeeded",
      attempts: 1,
      error: null,
    });
  });

  it("retries with a future runAt and finally fails", async () => {
    const snapshot = await store.enqueue({
      kind: "test.echo",
      payload: {},
      queue: "retry",
      maxAttempts: 2,
    });
    await store.claimNext({ queues: ["retry"], workerId: "w1" });

    expect(await store.retry(snapshot.jobId, "w1", "boom", new Date(Date.now() + 60_000))).toBe(
      true,
    );
    expect(await store.get(snapshot.jobId)).toMatchObject({
      status: "pending",
      attempts: 1,
      error: "boom",
    });
    expect(await store.claimNext({ queues: ["retry"], workerId: "w1" })).toBeNull();

    const second = await store.claimNext({
      queues: ["retry"],
      workerId: "w1",
      now: new Date(Date.now() + 120_000),
    });
    expect(second?.attempts).toBe(2);
    expect(await store.fail(snapshot.jobId, "w1", "final")).toBe(true);
    expect(await store.get(snapshot.jobId)).toMatchObject({
      status: "failed",
      attempts: 2,
      error: "final",
    });
  });

  it("reclaims stale running jobs or fails exhausted ones", async () => {
    const retryable = await store.enqueue({
      kind: "test.echo",
      payload: {},
      queue: "stale",
      maxAttempts: 2,
    });
    await store.claimNext({ queues: ["stale"], workerId: "lost-worker" });

    const reclaimed = await store.reclaimStale(new Date(Date.now() + 1_000));
    expect(reclaimed).toEqual([retryable.jobId]);
    expect(await store.get(retryable.jobId)).toMatchObject({
      status: "pending",
      attempts: 1,
      error: expect.stringContaining("租约失效"),
    });

    const exhausted = await store.enqueue({
      kind: "test.echo",
      payload: {},
      queue: "stale-exhausted",
      maxAttempts: 1,
    });
    await store.claimNext({ queues: ["stale-exhausted"], workerId: "lost-worker" });
    await store.reclaimStale(new Date(Date.now() + 1_000));
    expect(await store.get(exhausted.jobId)).toMatchObject({
      status: "failed",
      attempts: 1,
      error: expect.stringContaining("租约失效"),
    });
  });

  it("heartbeat renews the lease for the owning worker", async () => {
    const snapshot = await store.enqueue({ kind: "test.echo", payload: {}, queue: "heartbeat" });
    await store.claimNext({ queues: ["heartbeat"], workerId: "w1" });

    expect(await store.heartbeat(snapshot.jobId, "w2")).toBe(false);
    expect(await store.heartbeat(snapshot.jobId, "w1")).toBe(true);
  });

  it("surfaces serialization conflicts as a typed error", async () => {
    await store.enqueue({
      kind: "test.echo",
      payload: {},
      queue: "conflict",
      serializationKey: "same",
    });
    await expect(
      store.enqueue({
        kind: "test.echo",
        payload: {},
        queue: "conflict",
        serializationKey: "same",
      }),
    ).rejects.toBeInstanceOf(JobSerializationConflictError);
  });
});
