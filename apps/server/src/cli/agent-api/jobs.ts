/**
 * 回合作业的客户端：入队、等终态、列作业、取消、订阅。
 *
 * 服务端只回作业 id，回合在请求之外跑；CLI 是「一次命令一件事」的工具，
 * 所以默认等到终态再打印。等待与流式都只认库里的那一行——不依赖服务端进程内状态，
 * 因此多 worker / 多实例下看到的仍是同一份真相。
 */

import { API_VERSION } from "@ai-trpg/shared";
import { type ApiClient, ApiFailure } from "./client";

export type TurnJobProgress = {
  step: string;
  detail?: string;
};

export type TurnJobResult = {
  ok: boolean;
  messageCursor?: number;
  actions?: string[];
};

export type TurnJob = {
  jobId: string;
  kind: string;
  status: "pending" | "running" | "succeeded" | "failed" | "canceled";
  error: string | null;
  errorCode: string | null;
  progress: TurnJobProgress | null;
  /** 是否已请求取消：执行中的作业会在下一个检查点停下。 */
  cancelRequested: boolean;
  updatedAt: string;
  result: TurnJobResult | null;
};

export type TurnJobRef = Pick<TurnJob, "jobId">;

export type WaitOptions = {
  /** 两次查询之间停多久；默认 300ms。 */
  intervalMs?: number;
  /** 等多久还不终态就放弃；默认 10 分钟。 */
  timeoutMs?: number;
  /** 状态或阶段变了就叫一次；用来在命令行打出进度，不参与判断。 */
  onProgress?: (job: TurnJob) => void;
};

const DEFAULT_INTERVAL_MS = 300;
const DEFAULT_TIMEOUT_MS = 600_000;

function jobPath(game: string, jobId: string): string {
  return `/games/${encodeURIComponent(game)}/jobs/${encodeURIComponent(jobId)}`;
}

/** 作业终态之前一直读快照；失败按作业的错误码抛成一次 API 失败。 */
export async function waitForTurnJob(
  client: ApiClient,
  game: string,
  job: TurnJobRef,
  options: WaitOptions = {},
): Promise<TurnJob> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let lastSeen = "";

  while (true) {
    const { job: snapshot } = (await client.call({
      method: "GET",
      path: jobPath(game, job.jobId),
    })) as { job: TurnJob };

    const signature = `${snapshot.status}:${snapshot.progress?.step ?? ""}`;
    if (signature !== lastSeen) {
      lastSeen = signature;
      options.onProgress?.(snapshot);
    }

    if (snapshot.status === "succeeded") {
      return snapshot;
    }
    if (snapshot.status === "failed" || snapshot.status === "canceled") {
      // 作业把业务错误码留在了 errorCode 上：客户端据此决定重读还是放弃，不必解析文本。
      throw new ApiFailure(
        409,
        snapshot.errorCode ?? (snapshot.status === "canceled" ? "job_canceled" : "job_failed"),
        snapshot.error ?? (snapshot.status === "canceled" ? "作业在开始前被取消" : "作业失败"),
      );
    }
    if (Date.now() >= deadline) {
      throw new ApiFailure(
        0,
        "job_timeout",
        `等待作业超时：${job.jobId}（当前 ${snapshot.status}，可用 job-watch 继续观察）`,
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

export type ListTurnJobsOptions = {
  /** 默认只列活跃作业；`all` 连历史一起列。 */
  status?: "active" | "all";
  /** 只要更新时间晚于这个时刻的作业。 */
  updatedSince?: string;
  limit?: number;
};

/** 列这一局的作业：重载后重接、撞 409 时问「谁在跑」，都走这条。 */
export async function listTurnJobs(
  client: ApiClient,
  game: string,
  options: ListTurnJobsOptions = {},
): Promise<TurnJob[]> {
  const { jobs } = (await client.call({
    method: "GET",
    path: `/games/${encodeURIComponent(game)}/jobs`,
    query: {
      status: options.status,
      updatedSince: options.updatedSince,
      limit: options.limit,
    },
  })) as { jobs: TurnJob[] };
  return jobs;
}

/** 取消一个回合；`outcome` 说明是当场撤掉还是等它在检查点停下。 */
export async function cancelTurnJob(
  client: ApiClient,
  game: string,
  jobId: string,
): Promise<{ outcome: "canceled" | "requested"; job: TurnJob }> {
  return (await client.call({
    method: "POST",
    path: `${jobPath(game, jobId)}/cancel`,
  })) as { outcome: "canceled" | "requested"; job: TurnJob };
}

export type WatchTurnJobsOptions = {
  /** 从哪个游标之后补发；不给就只补活跃作业。 */
  since?: string;
  /** 收到一条事件就叫一次；返回 false 表示不再关心（用于提前退出）。 */
  onJob: (job: TurnJob) => void;
  /** 连接建好（收到头部）后叫一次。 */
  onOpen?: () => void;
};

/**
 * 订阅这一局的作业状态（SSE）。
 *
 * 这是 SSE 基建的验收探针：打印每条事件，直到调用方 abort。
 * 每条事件都是完整快照，所以打印与 `GET jobs/:job` 同源，不需要另做拼装。
 */
export async function watchTurnJobs(
  client: ApiClient,
  game: string,
  options: WatchTurnJobsOptions,
): Promise<void> {
  // `client.base` 只是服务端根地址；流式入口与 `call()` 一样要自己补上 API 前缀。
  const url = new URL(
    `${client.base}/api/${API_VERSION}/games/${encodeURIComponent(game)}/jobs/stream`,
  );
  if (options.since !== undefined) {
    url.searchParams.set("since", options.since);
  }
  // 浏览器的 EventSource 不能带请求头；这里两头都带，服务端两条路都认。
  url.searchParams.set("token", client.token);

  const response = await fetch(url, {
    headers: { accept: "text/event-stream", authorization: `Bearer ${client.token}` },
  });
  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => "");
    throw new ApiFailure(
      response.status,
      "job_stream_failed",
      `订阅作业状态失败：HTTP ${response.status} ${detail}`.trim(),
    );
  }
  options.onOpen?.();

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    // 事件之间以空行分隔；保留最后一段（可能是半条）等下一个 chunk。
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const job = parseServerSentEvent(raw);
      if (job !== undefined) {
        options.onJob(job);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/** 只关心 `event: job`：其它（心跳注释、retry 提示）一律忽略。 */
function parseServerSentEvent(raw: string): TurnJob | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trim());
    }
  }
  if (event !== "job" || data.length === 0) {
    return undefined;
  }
  const parsed = JSON.parse(data.join("\n")) as { job?: TurnJob };
  return parsed.job;
}
