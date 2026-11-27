import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAutoRefreshInterval } from "../autoRefresh";

/** 契约里的局列表一行；页面数据形状就是它，不另立一份。 */
export type GameSummary = components["schemas"]["GameSummary"];

export type GameListStatus = "active" | "completed";

/**
 * 删一局：数据库里那一行级联清掉。
 *
 * 它不碰 `logs/` 下的产物（快照、故事、系统提示词、轨迹），所以「不可恢复」说的是
 * 库里的世界——那些文件删完局面之后就再没有界面入口了，要一起清得手动删目录。
 */
export async function deleteGame(slug: string): Promise<void> {
  unwrap(await api.DELETE("/api/v1/games/{game}", { params: { path: { game: slug } } }));
}

/** 当前身份名下的局，按更新时间倒序。 */
export function useGames(status?: GameListStatus) {
  return useQuery({
    queryKey: ["games", status ?? "all"],
    refetchInterval: useAutoRefreshInterval(),
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games", {
          params: {
            query: { limit: 100, ...(status === undefined ? {} : { status }) },
          },
        }),
      ).games,
  });
}
