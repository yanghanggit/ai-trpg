import { unwrap } from "@ai-trpg/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * 接管一个角色：之后这个角色的回合由人决定，不再跑模型。
 *
 * 入口是 `agent:api take-control` 的同一件事——控制面操作，不推进世界。
 */
export function useTakeControl(game: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (actor: string) =>
      unwrap(
        await api.POST("/api/v1/games/{game}/actors/{actor}/control", {
          params: { path: { game, actor } },
        }),
      ),
    onSuccess: () => {
      // 接管改的是控制面：顺位上的 `control` 与投影都要重读。
      void queryClient.invalidateQueries({ queryKey: ["games", game, "action-order"] });
      void queryClient.invalidateQueries({ queryKey: ["games", game, "view"] });
    },
  });
}
