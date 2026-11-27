import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * 建局时导出的 system prompt（`logs/prompts`）。
 *
 * 它只在建局那一刻写一次，之后不随回合变，所以不开自动刷新：
 * 新的导出意味着又建了一局，那是页面重读一次就够的事。
 */
export function usePromptBundles(slug: string) {
  return useQuery({
    queryKey: ["games", slug, "prompts"],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/games/{game}/prompts", { params: { path: { game: slug } } })),
    enabled: slug.length > 0,
  });
}

export function usePromptBundle(slug: string, bundleId: string) {
  return useQuery({
    queryKey: ["games", slug, "prompt", bundleId],
    queryFn: async () =>
      unwrap(
        await api.GET("/api/v1/games/{game}/prompts/{bundle}", {
          params: { path: { game: slug, bundle: bundleId } },
        }),
      ),
    enabled: slug.length > 0 && bundleId.length > 0,
  });
}
