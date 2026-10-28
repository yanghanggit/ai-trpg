/** 作业轮询等待：非 HTTP 的观察入口，未来 SSE / 轮询路由可复用它。 */

import { setTimeout as delay } from "node:timers/promises";
import { JobFailedError, JobNotFoundError, JobTimeoutError } from "./errors";
import type { JobStore } from "./store";
import { isTerminalJobStatus, type JobSnapshot, type JobStatus } from "./types";

export const DEFAULT_JOB_WAIT_TIMEOUT_MS = 120_000;
export const DEFAULT_JOB_WAIT_POLL_INTERVAL_MS = 300;

export type WaitForJobOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  /** 状态发生变化时回调；首次查询也会触发。 */
  onSnapshot?: (snapshot: JobSnapshot) => void;
};

export async function waitForJob(
  store: Pick<JobStore, "get">,
  jobId: string,
  options: WaitForJobOptions = {},
): Promise<JobSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_JOB_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_JOB_WAIT_POLL_INTERVAL_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs 必须为正数");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new RangeError("pollIntervalMs 必须为正数");
  }

  const deadline = Date.now() + timeoutMs;
  let lastStatus: JobStatus | undefined;
  let lastSnapshot: JobSnapshot | undefined;

  while (true) {
    const snapshot = await store.get(jobId);
    if (!snapshot) {
      throw new JobNotFoundError(jobId);
    }
    lastSnapshot = snapshot;
    if (snapshot.status !== lastStatus) {
      lastStatus = snapshot.status;
      options.onSnapshot?.(snapshot);
    }

    if (snapshot.status === "succeeded") {
      return snapshot;
    }
    if (snapshot.status === "failed") {
      throw new JobFailedError(snapshot);
    }
    if (isTerminalJobStatus(snapshot.status)) {
      return snapshot;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new JobTimeoutError(jobId, timeoutMs, lastSnapshot?.status);
    }
    await delay(Math.min(pollIntervalMs, remaining), undefined, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }
}
