/**
 * 作业基础设施错误：入队冲突、作业失败、等待超时与不可重试的业务失败。
 *
 * 与 `ChatError` / `ImageGenError` 一样，预期内失败通过类型化异常表达；
 * 传输层 / HTTP 适配层以后按类型映射状态码，作业模块本身不依赖 HTTP。
 */

import type { JobSnapshot, JobStatus } from "./types";

export class JobNotFoundError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`作业不存在: ${jobId}`);
    this.name = "JobNotFoundError";
    this.jobId = jobId;
  }
}

export class JobFailedError extends Error {
  readonly snapshot: JobSnapshot;

  constructor(snapshot: JobSnapshot) {
    super(`作业失败: ${snapshot.jobId}${snapshot.error ? `: ${snapshot.error}` : ""}`);
    this.name = "JobFailedError";
    this.snapshot = snapshot;
  }
}

export class JobTimeoutError extends Error {
  readonly jobId: string;
  readonly timeoutMs: number;
  readonly lastStatus: JobStatus | undefined;

  constructor(jobId: string, timeoutMs: number, lastStatus: JobStatus | undefined) {
    super(
      `等待作业超时: ${jobId}（${timeoutMs}ms${lastStatus ? `，最后状态 ${lastStatus}` : ""}）`,
    );
    this.name = "JobTimeoutError";
    this.jobId = jobId;
    this.timeoutMs = timeoutMs;
    this.lastStatus = lastStatus;
  }
}

/** 同一 queue + serializationKey 已有 pending / running 作业。 */
export class JobSerializationConflictError extends Error {
  readonly queue: string;
  readonly serializationKey: string;
  readonly existingJobId: string | undefined;

  constructor(queue: string, serializationKey: string, existingJobId?: string) {
    super(
      `作业串行键已占用: queue=${queue} key=${serializationKey}` +
        `${existingJobId ? `（jobId=${existingJobId}）` : ""}`,
    );
    this.name = "JobSerializationConflictError";
    this.queue = queue;
    this.serializationKey = serializationKey;
    this.existingJobId = existingJobId;
  }
}

export class JobPayloadError extends Error {
  readonly kind: string;
  readonly issues: unknown;

  constructor(kind: string, issues: unknown) {
    super(`作业 payload 校验失败: ${kind}`);
    this.name = "JobPayloadError";
    this.kind = kind;
    this.issues = issues;
  }
}

export class JobDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobDefinitionError";
  }
}

/** handler 主动声明「重试也不会成功」，worker 将直接标记 failed。 */
export class NonRetryableJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NonRetryableJobError";
  }
}
