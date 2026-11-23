import { type components, unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 契约里的观看者投影；页面的数据形状就是它，不另立一份。 */
export type GameView = components["schemas"]["ActorView"];

/**
 * 读取一局在玩家眼里的样子。
 *
 * 不传 `actor` 时服务端用主角；`state` 那套上帝视角客户端不读。
 */
export function useGameView(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "view"],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/games/{game}", { params: { path: { game: slug } } })).view,
    enabled: slug.length > 0,
  });
}
