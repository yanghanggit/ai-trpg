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

export const JOB_STATUSES = ["pending", "running", "succeeded", "failed", "canceled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** 活跃：还没到终态；串行键只被这两种状态占用。 */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["pending", "running"];

/** 终态：不再变化，也不再占用串行键。`canceled` 只覆盖「还没开始就被撤掉」的那种。 */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["succeeded", "failed", "canceled"];

/**
 * 执行中的阶段标记：handler 自己报，作业层不认识业务。
 *
 * 只放「这一步在做什么」，不放世界状态——否则作业行会变成第二份世界。
 */
export type JobProgress = {
  step: string;
  detail?: string;
};

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
  /** 机器可读的失败码：handler 抛出的错误带 `code` 时留档，供客户端分辨处理方式。 */
  errorCode: string | null;
  /** 最近一次上报的执行阶段；没有上报过为 null。 */
  progress: JobProgress | null;
  /** 是否已请求取消；执行中的作业靠它在检查点停下。 */
  cancelRequested: boolean;
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
  /**
   * 上报当前阶段。写入是尽力而为：报进度失败不该让一个已经在跑的业务回合失败，
   * 所以它会吞掉错误、只记一行 warn。
   */
  reportProgress: (step: string, detail?: string) => Promise<void>;
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
  /** 同一组作业的组键（回合作业用 `turn:<gameId>`）。 */
  serializationKey?: string;
  /** 只取更新时间晚于它的行；流式补发与「断开后重查」用它。 */
  updatedSince?: Date;
  /** 默认 50，最大 500。 */
  limit?: number;
};

export type ClaimJobOptions = {
  queues: readonly string[];
  workerId: string;
  now?: Date;
};
