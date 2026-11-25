/**
 * 作业状态变更的广播：走 PostgreSQL 的 `LISTEN/NOTIFY`，不另设事件表。
 *
 * 通知只是「去看一眼」的信号，真相始终是库里的那一行：通知丢了、进程重启了、
 * 客户端断线了，重连后按 `updated_at` 重查就能补回来。所以这条通道只需要
 * 「谁变了」，不需要「变成什么」；载荷刻意很小（`NOTIFY` 上限 8000 字节）。
 *
 * 走数据库而不是进程内事件，是让 API 与 worker 分进程时仍然成立。
 */

import { sql } from "drizzle-orm";
import type { Database } from "../db/pool";
import type { JobSnapshot, JobStatus } from "./types";

/** 全局一条通道，接收方按 `serializationKey` 过滤；通道名是稳定契约，改它等于改协议。 */
export const JOBS_CHANNEL = "ai_trpg_jobs";

/** 一次状态变更的最小描述；不含结果与错误文本。 */
export type JobChange = {
  jobId: string;
  queue: string;
  kind: string;
  serializationKey: string | null;
  status: JobStatus;
};

export function jobChangeOf(
  job: Pick<JobSnapshot, "jobId" | "queue" | "kind" | "serializationKey" | "status">,
): JobChange {
  return {
    jobId: job.jobId,
    queue: job.queue,
    kind: job.kind,
    serializationKey: job.serializationKey,
    status: job.status,
  };
}

/**
 * 发一条通知。
 *
 * 尽力而为：广播失败不该回滚一次已经落账的业务变更——那一行已经写好了，
 * 少一条通知只是让某个观众晚一拍看到。调用方据此可以安全地吞掉异常。
 */
export async function notifyJobChange(db: Database, change: JobChange): Promise<void> {
  await db.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${JSON.stringify(change)})`);
}

export function parseJobChange(raw: string): JobChange | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.jobId !== "string" || typeof value.status !== "string") {
    return null;
  }
  return {
    jobId: value.jobId,
    queue: typeof value.queue === "string" ? value.queue : "default",
    kind: typeof value.kind === "string" ? value.kind : "",
    serializationKey: typeof value.serializationKey === "string" ? value.serializationKey : null,
    status: value.status as JobStatus,
  };
}
