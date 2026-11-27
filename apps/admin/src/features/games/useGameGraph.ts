import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAutoRefreshInterval } from "../autoRefresh";

export type GameGraph = components["schemas"]["GameGraph"];
export type GraphStage = GameGraph["stages"][number];
export type GraphActor = GameGraph["actors"][number];
export type GraphConnection = GameGraph["connections"][number];
export type GraphOrder = GameGraph["order"];

/**
 * 图谱：上帝视角的实体索引。
 *
 * 与控制台其它读数共用一个自动刷新开关——它不是另一份世界，只是同一份活状态的另一个切面。
 */
export function useGameGraph(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "graph"],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/games/{game}/graph", { params: { path: { game: slug } } })),
    enabled: slug.length > 0,
    refetchInterval: useAutoRefreshInterval(),
  });
}
