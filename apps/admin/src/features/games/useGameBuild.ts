import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * 建局数据：这一局一次性写下的那些行。
 *
 * 与「活状态」分开取：建局数据建完就不变，活状态每次回合都在长。
 */
export function useGameBuild(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "build"],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/games/{game}/build", { params: { path: { game: slug } } })),
    enabled: slug.length > 0,
    staleTime: 60_000,
  });
}
