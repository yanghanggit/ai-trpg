import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 内置内容包名（建局时作为 `seed` 提交）。 */
export function useContentPacks() {
  return useQuery({
    queryKey: ["games", "content-packs"],
    queryFn: async () => unwrap(await api.GET("/api/v1/games/content-packs")).packs,
    staleTime: 5 * 60 * 1000,
  });
}
