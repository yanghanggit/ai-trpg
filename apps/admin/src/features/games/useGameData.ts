import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAutoRefreshInterval } from "../autoRefresh";

export type JobView = components["schemas"]["TurnJob"];
export type MessageView = components["schemas"]["GameMessage"];

/** 公共事件流：上帝视角、带真实名字；按全局自动刷新开关重读。 */
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
    refetchInterval: useAutoRefreshInterval(),
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
