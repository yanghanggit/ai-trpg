import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { enqueueTurn, fetchActiveTurnJobs, fetchTurnJob, type TurnRequest } from "./api";
import { isTerminalJob, type TurnJob } from "./turnJob";

/** 两次读之间停多久：够快看见状态跳变，又不至于把服务端当轮询靶子。 */
const DEFAULT_POLL_INTERVAL_MS = 500;

export type UseTurnJobOptions = {
  /**
   * 到终态时叫一次。
   *
   * 这里只通知「这一回合结束了」，要不要重读投影、补空回合由调用方决定：
   * 作业层不替客户端解释世界。
   */
  onTerminal?: (job: TurnJob) => void;
  intervalMs?: number;
};

export type TurnJobState = {
  job: TurnJob | null;
  /** 还有回合在跑（含刚入队、还没读到第一份快照的那一小段）。 */
  isRunning: boolean;
  error: unknown;
  refresh: () => void;
};

/**
 * 盯住一条作业直到终态。
 *
 * 只读作业行，不读世界：活状态与事件流由调用方在终态后自己重读。
 */
export function useTurnJob(
  game: string,
  jobId: string | null,
  options: UseTurnJobOptions = {},
): TurnJobState {
  const onTerminal = useRef(options.onTerminal);
  onTerminal.current = options.onTerminal;
  const notified = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ["games", game, "jobs", jobId],
    enabled: jobId !== null,
    queryFn: async () => {
      if (jobId === null) {
        throw new Error("没有作业 id 时不该取数");
      }
      return fetchTurnJob(game, jobId);
    },
    refetchInterval: (intervalQuery) => {
      const snapshot = intervalQuery.state.data;
      if (snapshot !== undefined && isTerminalJob(snapshot)) {
        return false;
      }
      return options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    },
  });

  const job = query.data ?? null;
  useEffect(() => {
    if (job === null || !isTerminalJob(job)) {
      return;
    }
    // 同一条作业的同一版只通知一次；重读拿到更新的时间戳才再叫。
    const key = `${job.jobId}:${job.updatedAt}`;
    if (notified.current === key) {
      return;
    }
    notified.current = key;
    onTerminal.current?.(job);
  }, [job]);

  return {
    job,
    isRunning: job !== null && !isTerminalJob(job),
    error: query.error,
    refresh: () => {
      void query.refetch();
    },
  };
}

export type StartTurnState = TurnJobState & {
  /** 入队并开始盯住；返回入队时那份快照。 */
  start: (request: TurnRequest) => Promise<TurnJob>;
  /** 入队请求还在路上。 */
  starting: boolean;
  /** 放下当前作业（页面跳到下一件事时用）。 */
  reset: () => void;
  /** 接上一条已经在跑的作业：刷新页面、或别人先发起了一回合。 */
  adopt: (jobId: string) => void;
};

/** 入队一个回合并盯住它：页面只需要「开始」与「现在到哪了」。 */
export function useStartTurn(game: string, options: UseTurnJobOptions = {}): StartTurnState {
  const [jobId, setJobId] = useState<string | null>(null);
  const [started, setStarted] = useState<TurnJob | null>(null);
  const context = useTurnJob(game, jobId, options);

  const mutation = useMutation({
    mutationFn: (request: TurnRequest) => enqueueTurn(game, request),
    onMutate: () => {
      setJobId(null);
      setStarted(null);
    },
    onSuccess: (job) => {
      setStarted(job);
      setJobId(job.jobId);
    },
  });

  // 入队与第一次轮询之间有个空隙：用入队返回的那份快照顶上。
  const job = context.job ?? started;

  return {
    ...context,
    job,
    isRunning: mutation.isPending || (job !== null && !isTerminalJob(job)),
    // 入队被拒（视图过期、已有回合在跑）与读取失败都走同一个出口。
    error: mutation.error ?? context.error,
    start: mutation.mutateAsync,
    starting: mutation.isPending,
    adopt: (nextJobId: string) => {
      setStarted(null);
      setJobId(nextJobId);
    },
    reset: () => {
      setJobId(null);
      setStarted(null);
      mutation.reset();
    },
  };
}

/**
 * 这一局的活跃作业：重载页面后用它接上正在跑的那一个。
 *
 * 不拿它数回合——「有没有回合在跑」是它唯一的用途。
 */
export function useActiveTurnJobs(game: string, options: { intervalMs?: number } = {}) {
  return useQuery({
    queryKey: ["games", game, "jobs", "active"],
    queryFn: () => fetchActiveTurnJobs(game),
    refetchInterval: options.intervalMs ?? 2_000,
  });
}
