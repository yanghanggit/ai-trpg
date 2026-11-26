/**
 * 持久作业队列的读写边界（PostgreSQL + Drizzle）。
 *
 * 领取使用 `FOR UPDATE SKIP LOCKED`，支持多个 worker 并行；执行期间不持有事务，
 * 通过 `locked_at` 心跳判断 worker 是否失联。状态、错误、结果都在同一行，
 * 因此不需要旧系统的 `task_errors` 旁表。
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import { type JsonValue, jobs } from "../db/schema";
import { JobSerializationConflictError } from "./errors";
import { JOBS_CHANNEL, type JobChange, jobChangeOf, notifyJobChange } from "./notify";
import type {
  ClaimJobOptions,
  JobListFilter,
  JobProgress,
  JobRecord,
  JobSnapshot,
  JobStatus,
} from "./types";

type JobRow = typeof jobs.$inferSelect;

/** 取消请求的结果：`canceled` 是当场撤掉（排队中），`requested` 是等 worker 停（执行中）。 */
export type CancelOutcome = {
  outcome: "canceled" | "requested";
  job: JobSnapshot;
};

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
    errorCode: row.errorCode,
    progress: row.progress ?? null,
    cancelRequested: row.cancelRequested,
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

/** 列表上限：默认 50，最多 500。 */
function listLimit(filter: JobListFilter): number {
  return Math.min(Math.max(filter.limit ?? 50, 1), 500);
}

/**
 * 事务内广播：`NOTIFY` 在提交时才投递，所以事务内发、回滚了就等于没发。
 *
 * 这里用最朴素的 SQL 而不是注入一个 store：事务句柄与 store 的 `db` 不是同一个对象。
 */
async function notifyChange(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  row: JobRow | undefined,
): Promise<void> {
  if (!row) {
    return;
  }
  const change: JobChange = jobChangeOf(toSnapshot(row));
  try {
    await tx.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${JSON.stringify(change)})`);
  } catch {
    // 同上：通知失败不影响提交。
  }
}

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
      const snapshot = toSnapshot(row);
      await this.broadcast(row);
      return snapshot;
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

  /**
   * 与 `list` 同一套筛法，但连 `payload` / `result` 一起取回。
   *
   * 拼「作业视图」要 `result`，而快照刻意不带它；一次查询取全，别让调用方按 id 逐条补。
   */
  async listRecords(filter: JobListFilter = {}): Promise<JobRecord[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(this.listWhere(filter))
      .orderBy(desc(jobs.createdAt))
      .limit(listLimit(filter));
    return rows.map(toRecord);
  }

  async list(filter: JobListFilter = {}): Promise<JobSnapshot[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(this.listWhere(filter))
      .orderBy(desc(jobs.createdAt))
      .limit(listLimit(filter));
    return rows.map(toSnapshot);
  }

  private listWhere(filter: JobListFilter) {
    const conditions = [
      filter.kind ? eq(jobs.kind, filter.kind) : undefined,
      filter.queue ? eq(jobs.queue, filter.queue) : undefined,
      filter.statuses && filter.statuses.length > 0
        ? inArray(jobs.status, [...filter.statuses])
        : undefined,
      filter.serializationKey !== undefined
        ? eq(jobs.serializationKey, filter.serializationKey)
        : undefined,
      filter.updatedSince ? gt(jobs.updatedAt, filter.updatedSince) : undefined,
    ].filter((condition) => condition !== undefined);
    return conditions.length > 0 ? and(...conditions) : undefined;
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
      if (!updated) {
        return null;
      }
      // 通知写在事务里：提交成功才广播，观众看不到「领了又回滚」的假象。
      await notifyChange(tx, updated);
      return toRecord(updated);
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
        errorCode: null,
        finishedAt: now,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning();
    await this.broadcast(updated[0]);
    return updated.length > 0;
  }

  /** 失败后按 runAt 重试；错误保留用于诊断。 */
  async retry(
    jobId: string,
    workerId: string,
    error: string,
    runAt: Date,
    errorCode: string | null = null,
  ): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({
        status: "pending",
        error,
        errorCode,
        runAt,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning();
    await this.broadcast(updated[0]);
    return updated.length > 0;
  }

  /** 标记最终失败；只有当前 worker 仍持有租约时才生效。 */
  async fail(
    jobId: string,
    workerId: string,
    error: string,
    errorCode: string | null = null,
  ): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({
        status: "failed",
        error,
        errorCode,
        finishedAt: now,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning();
    await this.broadcast(updated[0]);
    return updated.length > 0;
  }

  /**
   * 上报执行阶段；只有仍持有租约的 worker 能写。
   *
   * 进度是这一行的一次 UPDATE：它同时让 `updated_at` 前进，等待方与流式补发都靠这个时间。
   */
  async setProgress(jobId: string, workerId: string, progress: JobProgress): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({ progress, updatedAt: now })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning();
    await this.broadcast(updated[0]);
    return updated.length > 0;
  }

  /**
   * 请求取消：排队中的当场撤，执行中的只置标记。
   *
   * 一条 UPDATE 定结果，避免「查到 pending、下一秒已 running」的竞态。
   */
  async requestCancel(jobId: string): Promise<CancelOutcome | null> {
    const now = new Date();
    const pendingNow = sql`${jobs.status} = 'pending'`;
    const [row] = await this.db
      .update(jobs)
      .set({
        status: sql`case when ${pendingNow} then 'canceled' else ${jobs.status} end`,
        finishedAt: sql`case when ${pendingNow} then ${now} else ${jobs.finishedAt} end`,
        lockedBy: sql`case when ${pendingNow} then null else ${jobs.lockedBy} end`,
        lockedAt: sql`case when ${pendingNow} then null else ${jobs.lockedAt} end`,
        cancelRequested: true,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["pending", "running"])))
      .returning();
    if (!row) {
      return null;
    }
    await this.broadcast(row);
    return {
      outcome: row.status === "canceled" ? "canceled" : "requested",
      job: toSnapshot(row),
    };
  }

  /** 执行中的作业在检查点停下：落成终态 `canceled`，同样认租约。 */
  async markCanceled(
    jobId: string,
    workerId: string,
    error: string,
    errorCode: string | null = "job_canceled",
  ): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({
        status: "canceled",
        error,
        errorCode,
        finishedAt: now,
        lockedBy: null,
        lockedAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
      .returning();
    await this.broadcast(updated[0]);
    return updated.length > 0;
  }

  /** worker 的取消检查点：按主键只读一列。 */
  async cancelRequested(jobId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ cancelRequested: jobs.cancelRequested })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    return row?.cancelRequested ?? false;
  }

  /**
   * 续租；worker 定期调用，避免长作业被其它 worker 误回收。
   *
   * 只动 `locked_at`：续租不是状态变更，不该推进 `updated_at`——那个时间同时是
   * 客户端的补发游标，被心跳推着走会让「变过什么」失去意义。
   */
  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const now = new Date();
    const updated = await this.db
      .update(jobs)
      .set({ lockedAt: now })
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
        const [updated] = await tx
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
          .where(eq(jobs.id, row.id))
          .returning();
        await notifyChange(tx, updated);
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
      canceled: 0,
    };
    for (const row of rows) {
      counts[row.status] = row.count;
    }
    return counts;
  }

  /** 广播一次状态变更；失败只当作少一条通知，不影响已经写好的那一行。 */
  private async broadcast(row: JobRow | undefined): Promise<void> {
    if (!row) {
      return;
    }
    try {
      await notifyJobChange(this.db, jobChangeOf(toSnapshot(row)));
    } catch {
      // 广播是尽力而为：库里的行才是真相，观众重连时会按 updated_at 补查。
    }
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
