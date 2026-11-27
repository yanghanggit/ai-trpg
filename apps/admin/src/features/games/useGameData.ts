import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAutoRefreshInterval } from "../autoRefresh";

export type JobView = components["schemas"]["TurnJob"];
export type MessageView = components["schemas"]["GameMessage"];

export type MessageListView = { messages: MessageView[]; messageCursor: number };

/** 公共事件流：上帝视角、带真实名字；按全局自动刷新开关重读。 */
export function useGameMessages(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "messages"],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/messages", {
          params: { path: { game: slug }, query: { limit: 200 } },
        }),
      ),
    enabled: slug.length > 0,
    refetchInterval: useAutoRefreshInterval(),
  });
}

/**
 * 事件流当前最大序号——「上次看过之后又多了几条」要靠它算。
 *
 * 只要一个数，所以顺手用最小的那次读（`limit=1`，服务端仍会把最大序号带回来）。
 */
export function useMessageCursor(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "messages", "cursor"],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/messages", {
          params: { path: { game: slug }, query: { after: 0, limit: 1 } },
        }),
      ).messageCursor,
    enabled: slug.length > 0,
    refetchInterval: useAutoRefreshInterval(),
  });
}

/**
 * 水位之后的增量：服务端按 `sequence > after` 过滤，所以只带新的回来。
 *
 * 不接自动刷新——这个请求回答「我错过的那几条」，看过一次就把水位推到最新，
 * 让它每 5 秒重读一遍等于替人把它们吃掉。
 */
export function useMessagesAfter(slug: string, after: number | undefined) {
  return useQuery({
    queryKey: ["games", slug, "messages", "after", after ?? -1],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/messages", {
          params: { path: { game: slug }, query: { after: after ?? 0 } },
        }),
      ),
    enabled: slug.length > 0 && after !== undefined,
    refetchInterval: false,
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
