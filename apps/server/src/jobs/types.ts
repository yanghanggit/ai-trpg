/**
 * 后台作业（Job）是进入持久队列、可追踪的工作单元；`jobId` 是它在队列里的唯一标识。
 *
 * 旧系统的 ``task`` 概念与 ``job_id`` 标识是为 Procrastinate 让路；本项目自己拥有
 * 队列表，因此概念与标识统一为 ``job`` / ``jobId``，不再维护两套叫法。
 * 状态不另设事件表：一行作业同时承载状态、最后一次错误与结果。
 */

import type { z } from "zod";
import type { JsonValue } from "../db/schema";
import type { Logger } from "../logging";

export const JOB_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["succeeded", "failed"];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/** 对外可查询的作业快照；不含 payload / result / worker 租约字段。 */
export type JobSnapshot = {
  jobId: string;
  kind: string;
  queue: string;
  status: JobStatus;
  serializationKey: string | null;
  attempts: number;
  maxAttempts: number;
  /** 最后一次失败的错误文本；pending 重试时也可能保留。 */
  error: string | null;
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** worker 领取作业时使用的完整记录。 */
export type JobRecord = JobSnapshot & {
  payload: JsonValue;
  result: JsonValue | null;
  lockedBy: string | null;
  lockedAt: Date | null;
};

export type JobContext = {
  jobId: string;
  kind: string;
  queue: string;
  /** 从 1 开始；第一次执行时为 1。 */
  attempt: number;
  maxAttempts: number;
  signal: AbortSignal;
  logger: Logger;
};

export type JobDefinition<Payload, Result = unknown> = {
  name: string;
  description?: string;
  payload: z.ZodType<Payload>;
  run: (payload: Payload, context: JobContext) => Promise<Result> | Result;
  /** 默认 1；失败后按次数重试。 */
  maxAttempts?: number;
  /** 可选超时；只 abort signal，不强行终止已产生副作用的 handler。 */
  timeoutMs?: number;
};

export type EnqueueJobOptions = {
  /** 默认 `default`。 */
  queue?: string;
  /**
   * 同一 queue + key 同时只允许一个 pending / running 作业；
   * 用于复刻旧系统的「同一房间同时只有一个 pipeline」。
   */
  serializationKey?: string;
  runAt?: Date;
  maxAttempts?: number;
};

export type JobListFilter = {
  statuses?: readonly JobStatus[];
  kind?: string;
  queue?: string;
  /** 默认 50，最大 500。 */
  limit?: number;
};

export type ClaimJobOptions = {
  queues: readonly string[];
  workerId: string;
  now?: Date;
};
