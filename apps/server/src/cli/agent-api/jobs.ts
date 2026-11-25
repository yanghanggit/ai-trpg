/**
 * 回合作业的客户端：入队一次、等一次终态。
 *
 * 服务端只回 202 + `jobId`，回合在请求之外跑；CLI 是「一次命令一件事」的工具，
 * 所以默认等到终态再打印。轮询复用 `GET /games/{game}/jobs/{job}` 的快照，
 * 不做进程内等待——多进程 / 多 worker 下看到的仍是同一份真相。
 */

import { type ApiClient, ApiFailure } from "./client";

export type TurnJobResult = {
  ok: boolean;
  messageCursor?: number;
  actions?: string[];
};

export type TurnJob = {
  jobId: string;
  kind: string;
  status: "pending" | "running" | "succeeded" | "failed";
  error: string | null;
  errorCode: string | null;
  result: TurnJobResult | null;
};

export type TurnJobRef = Pick<TurnJob, "jobId">;

export type WaitOptions = {
  /** 两次查询之间停多久；默认 300ms。 */
  intervalMs?: number;
  /** 等多久还不终态就放弃；默认 10 分钟。 */
  timeoutMs?: number;
};

const DEFAULT_INTERVAL_MS = 300;
const DEFAULT_TIMEOUT_MS = 600_000;

/** 作业终态之前一直读快照；失败按作业的错误码抛成一次 API 失败。 */
export async function waitForTurnJob(
  client: ApiClient,
  game: string,
  job: TurnJobRef,
  options: WaitOptions = {},
): Promise<TurnJob> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  while (true) {
    const { job: snapshot } = (await client.call({
      method: "GET",
      path: `/games/${encodeURIComponent(game)}/jobs/${encodeURIComponent(job.jobId)}`,
    })) as { job: TurnJob };

    if (snapshot.status === "succeeded") {
      return snapshot;
    }
    if (snapshot.status === "failed") {
      // 作业把业务错误码留在了 errorCode 上：客户端据此决定重读还是放弃，不必解析文本。
      throw new ApiFailure(409, snapshot.errorCode ?? "job_failed", snapshot.error ?? "作业失败");
    }
    if (Date.now() >= deadline) {
      throw new ApiFailure(
        0,
        "job_timeout",
        `等待作业超时：${job.jobId}（当前 ${snapshot.status}，可用 job watch 继续观察）`,
      );
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
}

/** 入队一个回合并等到终态；返回作业快照（含结果摘要）。 */
export async function runTurnJob(
  client: ApiClient,
  game: string,
  path: string,
  body: Record<string, unknown>,
  options: WaitOptions = {},
): Promise<TurnJob> {
  const { job } = (await client.call({
    method: "POST",
    path: `/games/${encodeURIComponent(game)}${path}`,
    body,
  })) as { job: TurnJob };
  return waitForTurnJob(client, game, job, options);
}
