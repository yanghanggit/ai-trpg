import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 读取一局的完整状态。写操作之后由调用方决定是否重取。 */
export function useGame(slug: string) {
  return useQuery({
    queryKey: ["games", slug],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/games/{game}", { params: { path: { game: slug } } })).state,
    enabled: slug.length > 0,
  });
}
