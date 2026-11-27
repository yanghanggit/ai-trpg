import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAutoRefreshInterval } from "../autoRefresh";

/**
 * 产物：磁盘上的快照（`logs/worlds`）与故事（`logs/stories`）。
 *
 * 都是文件，不属于数据库，所以各自读各自的；页面上只做清单与原文，不做聚合。
 */
export function useSnapshots(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "snapshots"],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/games/{game}/snapshots", { params: { path: { game: slug } } })),
    enabled: slug.length > 0,
    refetchInterval: useAutoRefreshInterval(),
  });
}

export function useSnapshot(slug: string, snapshotId: string, part?: string) {
  return useQuery({
    queryKey: ["games", slug, "snapshot", snapshotId, part ?? ""],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/snapshots/{snapshot}", {
          params: {
            path: { game: slug, snapshot: snapshotId },
            query: part === undefined ? {} : { part },
          },
        }),
      ),
    enabled: slug.length > 0 && snapshotId.length > 0,
  });
}

export function useStories(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "stories"],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/games/{game}/stories", { params: { path: { game: slug } } })),
    enabled: slug.length > 0,
    refetchInterval: useAutoRefreshInterval(),
  });
}

export function useStory(slug: string, name: string) {
  return useQuery({
    queryKey: ["games", slug, "story", name],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/stories/{story}", {
          params: { path: { game: slug, story: name } },
        }),
      ),
    enabled: slug.length > 0 && name.length > 0,
  });
}
