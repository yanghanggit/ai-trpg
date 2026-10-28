import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineJob,
  type EnqueueJobInput,
  enqueueJob,
  JobDefinitionError,
  JobPayloadError,
  JobRegistry,
  type JobSnapshot,
  toJsonValue,
} from "../src/jobs";

function snapshot(input: EnqueueJobInput): JobSnapshot {
  const now = new Date("2026-01-02T03:04:05.000Z");
  return {
    jobId: "job-1",
    kind: input.kind,
    queue: input.queue ?? "default",
    status: "pending",
    serializationKey: input.serializationKey ?? null,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 1,
    error: null,
    runAt: now,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("JobRegistry", () => {
  it("registers and resolves explicit job definitions", () => {
    const registry = new JobRegistry();
    const job = defineJob({
      name: "test.echo",
      payload: z.object({ value: z.string() }),
      run: ({ value }) => value,
    });

    registry.register(job);
    expect(registry.names()).toEqual(["test.echo"]);
    expect(registry.get("test.echo")).toBe(job);
    expect(registry.require("test.echo")).toBe(job);
  });

  it("rejects invalid and duplicate definitions", () => {
    const registry = new JobRegistry();
    const job = defineJob({
      name: "test.echo",
      payload: z.object({}),
      run: () => undefined,
    });
    registry.register(job);

    expect(() => registry.register(job)).toThrow(JobDefinitionError);
    expect(() =>
      defineJob({ name: "BadName", payload: z.object({}), run: () => undefined }),
    ).toThrow(JobDefinitionError);
    expect(() =>
      defineJob({
        name: "test.bad-max",
        payload: z.object({}),
        run: () => undefined,
        maxAttempts: 0,
      }),
    ).toThrow(JobDefinitionError);
    expect(() =>
      defineJob({
        name: "test.bad-timeout",
        payload: z.object({}),
        run: () => undefined,
        timeoutMs: 0,
      }),
    ).toThrow(JobDefinitionError);
    expect(() => registry.require("test.missing")).toThrow(/未注册/);
  });
});

describe("enqueueJob", () => {
  it("validates payload and fills defaults", async () => {
    const calls: EnqueueJobInput[] = [];
    const store = {
      enqueue: async (input: EnqueueJobInput): Promise<JobSnapshot> => {
        calls.push(input);
        return snapshot(input);
      },
    };
    const job = defineJob({
      name: "test.echo",
      payload: z.object({ value: z.string() }),
      run: ({ value }) => value,
      maxAttempts: 3,
    });

    const result = await enqueueJob(store, job, { value: "hello" });
    expect(result.jobId).toBe("job-1");
    expect(calls[0]).toMatchObject({
      kind: "test.echo",
      payload: { value: "hello" },
      queue: "default",
      serializationKey: null,
      maxAttempts: 3,
    });
  });

  it("rejects invalid payloads before touching the store", async () => {
    let called = 0;
    const store = {
      enqueue: async (input: EnqueueJobInput): Promise<JobSnapshot> => {
        called += 1;
        return snapshot(input);
      },
    };
    const job = defineJob({
      name: "test.echo",
      payload: z.object({ value: z.string().min(3) }),
      run: ({ value }) => value,
    });

    await expect(enqueueJob(store, job, { value: "x" })).rejects.toBeInstanceOf(JobPayloadError);
    expect(called).toBe(0);
  });

  it("serializes only JSON values", () => {
    expect(toJsonValue({ nested: [1, true, null] }, "payload")).toEqual({
      nested: [1, true, null],
    });
    expect(() => toJsonValue(undefined, "payload")).toThrow(/不是 JSON 值/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => toJsonValue(circular, "payload")).toThrow(/不是可序列化/);
  });
});
