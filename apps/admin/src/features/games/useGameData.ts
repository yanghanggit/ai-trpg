import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export type JobView = components["schemas"]["TurnJob"];
export type MessageView = components["schemas"]["GameMessage"];

/**
 * 页面在看着时的自动刷新间隔。
 *
 * 只有事件流按这个节奏重读：回合落地就会追加一行，其他面板是按需读的原文，
 * 反复重读既没新东西也白烧请求。
 */
export const AUTO_REFRESH_INTERVAL_MS = 5000;

/** 公共事件流：上帝视角、带真实名字。`refetch` 关掉时只按需读。 */
export function useGameMessages(slug: string, refetch: boolean) {
  return useQuery({
    queryKey: ["games", slug, "messages"],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/messages", {
          params: { path: { game: slug }, query: { limit: 200 } },
        }),
      ).messages,
    enabled: slug.length > 0,
    refetchInterval: refetch ? AUTO_REFRESH_INTERVAL_MS : false,
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
