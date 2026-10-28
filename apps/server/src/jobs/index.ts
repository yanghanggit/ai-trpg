/**
 * 持久作业队列（PostgreSQL）：入队、worker、状态快照与等待。
 *
 * 这一层不依赖 HTTP；未来的路由只需入队并返回 `jobId`，再把查询 / 等待接到
 * `JobStore.get` 与 `waitForJob`。进程内 worker 由调用方启动，不在这里隐式常驻。
 */

export { enqueueJob } from "./enqueue";
export {
  JobDefinitionError,
  JobFailedError,
  JobNotFoundError,
  JobPayloadError,
  JobSerializationConflictError,
  JobTimeoutError,
  NonRetryableJobError,
} from "./errors";
export { toJsonValue } from "./json";
export { defineJob, JobRegistry } from "./registry";
export { type EnqueueJobInput, JobStore } from "./store";
export {
  type ClaimJobOptions,
  type EnqueueJobOptions,
  isTerminalJobStatus,
  JOB_STATUSES,
  type JobContext,
  type JobDefinition,
  type JobListFilter,
  type JobRecord,
  type JobSnapshot,
  type JobStatus,
  TERMINAL_JOB_STATUSES,
} from "./types";
export {
  DEFAULT_JOB_WAIT_POLL_INTERVAL_MS,
  DEFAULT_JOB_WAIT_TIMEOUT_MS,
  type WaitForJobOptions,
  waitForJob,
} from "./wait";
export { JobWorker, type JobWorkerOptions } from "./worker";
