import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export type JobView = components["schemas"]["TurnJob"];
export type MessageView = components["schemas"]["GameMessage"];

/** 活跃作业在跑时按这个间隔重读；没有活跃作业就不轮询。 */
export const ACTIVE_JOB_REFETCH_INTERVAL_MS = 2000;
/** 单个作业盯终态时的间隔：比列表快一档，入队后能立刻看到结果。 */
export const WATCHED_JOB_REFETCH_INTERVAL_MS = 1500;
export const JOB_HISTORY_LIMIT = 20;

export function isActiveJob(status: JobView["status"]): boolean {
  return status === "pending" || status === "running";
}

export function isTerminalJob(status: JobView["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

/** 上帝视角的活状态；形状是 `unknown`，后台原样当 JSON 展示。 */
export function useGameState(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "state"],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/games/{game}/state", { params: { path: { game: slug } } }))
        .state,
    enabled: slug.length > 0,
  });
}

/** 公共事件流：上帝视角、带真实名字。 */
export function useGameMessages(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "messages"],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/messages", {
          params: { path: { game: slug }, query: { limit: 200 } },
        }),
      ).messages,
    enabled: slug.length > 0,
  });
}

/** 这一局的作业：活跃的与历史各一份视图，读的是同一行。 */
export function useGameJobs(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "jobs"],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/jobs", {
          params: { path: { game: slug }, query: { status: "all", limit: 50 } },
        }),
      ).jobs,
    enabled: slug.length > 0,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((job) => isActiveJob(job.status))
        ? ACTIVE_JOB_REFETCH_INTERVAL_MS
        : false,
  });
}

/** 单个作业：入队或取消之后盯到终态，不靠「入队成功」推断成功。 */
export function useGameJob(slug: string, jobId: string | undefined) {
  return useQuery({
    queryKey: ["games", slug, "job", jobId ?? ""],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/jobs/{job}", {
          params: { path: { game: slug, job: jobId ?? "" } },
        }),
      ).job,
    enabled: slug.length > 0 && jobId !== undefined && jobId.length > 0,
    refetchInterval: (query) => {
      const job = query.state.data;
      return job !== undefined && isTerminalJob(job.status)
        ? false
        : WATCHED_JOB_REFETCH_INTERVAL_MS;
    },
  });
}

export type MemoryOwner = "actor" | "stage" | "world";

/** 某个 agent 当前的 memory 原文：只读旁路，摊开给人看。 */
export function useMemory(slug: string, input: { owner: MemoryOwner; name?: string } | undefined) {
  return useQuery({
    queryKey: ["games", slug, "memory", input?.owner ?? "", input?.name ?? ""],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/memory", {
          params: {
            path: { game: slug },
            query: {
              owner: input?.owner ?? "actor",
              ...(input?.name === undefined ? {} : { name: input.name }),
            },
          },
        }),
      ),
    enabled: slug.length > 0 && input !== undefined,
  });
}

/** 只读扫描：actor 记忆里有没有真名泄漏。 */
export function useNameLeaks(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ["games", slug, "name-leaks"],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/name-leaks", { params: { path: { game: slug } } }),
      ),
    enabled: slug.length > 0 && enabled,
  });
}
