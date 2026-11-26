import { type components, unwrap } from "@ai-trpg/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 顺位：控制面投影，页面读它判断「轮到谁、谁来动」。 */
export type ActionOrder = components["schemas"]["ActionOrder"];

/** 读当前进行中的顺位；没有就回 null，不是错误。 */
export function useActionOrder(game: string) {
  return useQuery({
    queryKey: ["games", game, "action-order"],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/action-orders/current", {
          params: { path: { game } },
        }),
      ).order,
    // 顺位会随别人的回合变；这一页开着时按间隔刷新，免得一直显示旧的名次。
    refetchInterval: 2_000,
  });
}

/** 开一条顺位：按敏捷现值排序由服务端算，客户端不传顺序。 */
export function useCreateActionOrder(game: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/v1/games/{game}/action-orders", {
          params: { path: { game } },
        }),
      ).order,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["games", game, "action-order"] });
    },
  });
}

/** 完成一条顺位：打标记，之后不再记数。 */
export function useCompleteActionOrder(game: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (order: string) =>
      unwrap(
        await api.POST("/api/v1/games/{game}/action-orders/{order}/complete", {
          params: { path: { game, order } },
        }),
      ).order,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["games", game, "action-order"] });
    },
  });
}

/** 移除一条顺位：删行，条目级联。 */
export function useRemoveActionOrder(game: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (order: string) =>
      unwrap(
        await api.DELETE("/api/v1/games/{game}/action-orders/{order}", {
          params: { path: { game, order } },
        }),
      ).removed,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["games", game, "action-order"] });
    },
  });
}
