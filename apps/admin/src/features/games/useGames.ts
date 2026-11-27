import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAutoRefreshInterval } from "../autoRefresh";

/** 契约里的局列表一行；页面数据形状就是它，不另立一份。 */
export type GameSummary = components["schemas"]["GameSummary"];

export type GameListStatus = "active" | "completed";

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
