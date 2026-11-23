import { type components, unwrap } from "@ai-trpg/api-client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 公共事件流的一行；形状来自契约，不在这里另立一份。 */
export type GameMessage = components["schemas"]["GameMessage"];

/** 单次拉取的条数；「加载更多」按游标继续往后取。 */
const PAGE_SIZE = 100;

/**
 * 全上下文事件流，按序号正序分页。
 *
 * 只在浮窗打开时取（`enabled`），关掉不占请求；`after` 是游标，所以后续的
 * 回合推进可以复用同一条增量路径，不需要第二套读法。
 */
export function useGameMessages(slug: string, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ["games", slug, "messages"],
    enabled: enabled && slug.length > 0,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET("/api/v1/games/{game}/messages", {
          params: {
            path: { game: slug },
            query: { after: pageParam, limit: PAGE_SIZE },
          },
        }),
      ),
    getNextPageParam: (lastPage) => {
      const newest = lastPage.messages.at(-1)?.sequence;
      if (lastPage.messages.length < PAGE_SIZE || newest === undefined) {
        return undefined;
      }
      return newest;
    },
  });

  const items: GameMessage[] = query.data?.pages.flatMap((page) => page.messages) ?? [];
  const total = query.data?.pages.at(-1)?.messageCursor ?? 0;

  return {
    items,
    total,
    hasMore: query.hasNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
    loading: query.isPending,
    loadingMore: query.isFetchingNextPage,
    error: query.isError ? query.error : undefined,
  };
}
