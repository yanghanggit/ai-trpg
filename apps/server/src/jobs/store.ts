/**
 * 持久作业队列的读写边界（PostgreSQL + Drizzle）。
 *
 * 领取使用 `FOR UPDATE SKIP LOCKED`，支持多个 worker 并行；执行期间不持有事务，
 * 通过 `locked_at` 心跳判断 worker 是否失联。状态、错误、结果都在同一行，
 * 因此不需要旧系统的 `task_errors` 旁表。
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import { type JsonValue, jobs } from "../db/schema";
import { JobSerializationConflictError } from "./errors";
import type { ClaimJobOptions, JobListFilter, JobRecord, JobSnapshot, JobStatus } from "./types";

type JobRow = typeof jobs.$inferSelect;

export type EnqueueJobInput = {
  kind: string;
  payload: JsonValue;
  queue?: string;
  serializationKey?: string | null;
  maxAttempts?: number;
  runAt?: Date;
};

function toSnapshot(row: JobRow): JobSnapshot {
  return {
    jobId: row.id,
    kind: row.kind,
    queue: row.queue,
    status: row.status,
    serializationKey: row.serializationKey,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    error: row.error,
    runAt: row.runAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecord(row: JobRow): JobRecord {
  return {
    ...toSnapshot(row),
    payload: row.payload,
    result: row.result,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt,
  };
}

const SERIALIZATION_UNIQUE_INDEX = "jobs_active_serialization_unique";

function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code === "23505") {
    const constraint = (error as { constraint?: unknown }).constraint;
    return constraint === undefined || constraint === SERIALIZATION_UNIQUE_INDEX;
  }
  // Drizzle 会把驱动错误包在 cause 里。
  return isSerializationConflict((error as { cause?: unknown }).cause);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class JobStore {
  constructor(readonly db: Database) {}

  /** 入队；同一 queue + serializationKey 已有活跃作业时抛串行冲突。 */
  async enqueue(input: EnqueueJobInput): Promise<JobSnapshot> {
    const queue = input.queue?.trim() || "default";
    const maxAttempts = input.maxAttempts ?? 1;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError("maxAttempts 必须为正整数");
    }
    const now = new Date();
    const serializationKey = input.serializationKey?.trim() || null;

    try {
      const [row] = await this.db
        .insert(jobs)
        .values({
          id: randomUUID(),
          kind: input.kind,
          queue,
          payload: input.payload,
          serializationKey,
          maxAttempts,
          runAt: input.runAt ?? now,
          updatedAt: now,
        })
        .returning();
      if (!row) {
        throw new Error("作业入队失败：没有返回行");
      }
      return toSnapshot(row);
    } catch (error) {
      if (!isSerializationConflict(error) || serializationKey === null) {
        throw error;
      }
      const existing = await this.findActive(queue, serializationKey);
      throw new JobSerializationConflictError(queue, serializationKey, existing?.jobId);
    }
  }

  async get(jobId: string): Promise<JobSnapshot | null> {
    if (!UUID_PATTERN.test(jobId)) {
      return null;
    }
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return row ? toSnapshot(row) : null;
  }

  async getRecord(jobId: string): Promise<JobRecord | null> {
    if (!UUID_PATTERN.test(jobId)) {
      return null;
    }
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return row ? toRecord(row) : null;
  }

  async list(filter: JobListFilter = {}): Promise<JobSnapshot[]> {
    const conditions = [
      filter.kind ? eq(jobs.kind, filter.kind) : undefined,
      filter.queue ? eq(jobs.queue, filter.queue) : undefined,
      filter.statuses && filter.statuses.length > 0
        ? inArray(jobs.status, [...filter.statuses])
        : undefined,
    ].filter((condition) => condition !== undefined);

    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const rows = await this.db
      .select()
      .from(jobs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(jobs.createdAt))
      .limit(limit);
    return rows.map(toSnapshot);
  }

  /** 领取一条到期作业；没有可领取作业时返回 null。 */
  async claimNext(options: ClaimJobOptions): Promise<JobRecord | null> {
    if (options.queues.length === 0) {
      return null;
    }
    const now = options.now ?? new Date();

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.status, "pending"),
            lte(jobs.runAt, now),
            inArray(jobs.queue, [...options.queues]),
          ),
        )
        .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) {
        return null;
      }

      const [updated] = await tx
        .update(jobs)
        .set({
          status: "running",
          attempts: sql`${jobs.attempts} + 1`,
          lockedBy: options.workerId,
          lockedAt: now,
          startedAt: row.startedAt ?? now,
          updatedAt: now,
        })
        .where(and(eq(jobs.id, row.id), eq(jobs.status, "pending")))
        .returning();
      return updated ? toRecord(updated) : null;
    });
  }

  /** 标记成功；只有当前 worker 仍持有租约时才生效。 */
  async complete(jobId: string, workerId: string, result: JsonValue | null): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({
        status: "succeeded",
        result,
        error: null,
        finishedAt: now,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning({ id: jobs.id });
    return updated.length > 0;
  }

  /** 失败后按 runAt 重试；错误保留用于诊断。 */
  async retry(jobId: string, workerId: string, error: string, runAt: Date): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({
        status: "pending",
        error,
        runAt,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning({ id: jobs.id });
    return updated.length > 0;
  }

  /** 标记最终失败；只有当前 worker 仍持有租约时才生效。 */
  async fail(jobId: string, workerId: string, error: string): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({
        status: "failed",
        error,
        finishedAt: now,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning({ id: jobs.id });
    return updated.length > 0;
  }

  /** 续租；worker 定期调用，避免长作业被其它 worker 误回收。 */
  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({ lockedAt: now, updatedAt: now })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning({ id: jobs.id });
    return updated.length > 0;
  }

  /**
   * 回收失联 worker 的作业：未耗尽重试次数的回到 pending，耗尽则标记 failed。
   * 返回被回收的 jobId。
   */
  async reclaimStale(staleBefore: Date): Promise<string[]> {
    const now = new Date();
    const staleError = "worker 租约失效：作业执行期间未收到心跳";

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(jobs)
        .where(
          and(eq(jobs.status, "running"), isNotNull(jobs.lockedAt), lt(jobs.lockedAt, staleBefore)),
        )
        .for("update", { skipLocked: true });

      const reclaimed: string[] = [];
      for (const row of rows) {
        const exhausted = row.attempts >= row.maxAttempts;
        await tx
          .update(jobs)
          .set(
            exhausted
              ? {
                  status: "failed",
                  error: staleError,
                  finishedAt: now,
                  lockedBy: null,
                  lockedAt: null,
                  updatedAt: now,
                }
              : {
                  status: "pending",
                  error: staleError,
                  runAt: now,
                  lockedBy: null,
                  lockedAt: null,
                  updatedAt: now,
                },
          )
          .where(eq(jobs.id, row.id));
        reclaimed.push(row.id);
      }
      return reclaimed;
    });
  }

  async countByStatus(): Promise<Record<JobStatus, number>> {
    const rows = await this.db
      .select({ status: jobs.status, count: sql<number>`count(*)::int` })
      .from(jobs)
      .groupBy(jobs.status);
    const counts: Record<JobStatus, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
    };
    for (const row of rows) {
      counts[row.status] = row.count;
    }
    return counts;
  }

  private async findActive(
    queue: string,
    serializationKey: string,
  ): Promise<JobSnapshot | undefined> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.queue, queue),
          eq(jobs.serializationKey, serializationKey),
          inArray(jobs.status, ["pending", "running"]),
        ),
      )
      .orderBy(asc(jobs.createdAt))
      .limit(1);
    return row ? toSnapshot(row) : undefined;
  }
}
