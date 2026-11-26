import { useEffect, useState } from "react";
import { apiBaseUrl, playerUsername } from "../../api/client";
import type { TurnJob } from "./turnJob";

export type JobStreamState = {
  /** 按 jobId 收着的最近一份快照；后到的旧版本会被丢掉。 */
  jobs: Record<string, TurnJob>;
  connected: boolean;
};

/**
 * 订阅这一局的作业状态。
 *
 * 这是轮询的替代读法，不是它的前提：流断了就退回轮询，页面不该因为「没连着」而不干活。
 * 事件是快照不是流水账——同一作业连续变几次可能只来一条，所以这里按作业收、按更新时间去重。
 */
export function useJobStream(game: string, options: { enabled?: boolean } = {}): JobStreamState {
  const enabled = options.enabled ?? true;
  const [jobs, setJobs] = useState<Record<string, TurnJob>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // 浏览器的 EventSource 不能自带请求头：这条流认查询串里的开发期身份。
    const url = new URL(`${apiBaseUrl}/api/v1/games/${encodeURIComponent(game)}/jobs/stream`);
    url.searchParams.set("token", playerUsername);
    const source = new EventSource(url);

    const onOpen = () => {
      setConnected(true);
    };
    const onError = () => {
      // 断了不用管：EventSource 自己会重连，服务端重连后会按游标补发。
      setConnected(false);
    };
    const onJob = (event: Event) => {
      const payload = event as MessageEvent<string>;
      const job = (JSON.parse(payload.data) as { job: TurnJob }).job;
      setJobs((previous) => {
        const known = previous[job.jobId];
        if (known !== undefined && known.updatedAt >= job.updatedAt) {
          return previous;
        }
        return { ...previous, [job.jobId]: job };
      });
    };

    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    source.addEventListener("job", onJob);
    return () => {
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.removeEventListener("job", onJob);
      source.close();
      setConnected(false);
    };
  }, [game, enabled]);

  return { jobs, connected };
}
