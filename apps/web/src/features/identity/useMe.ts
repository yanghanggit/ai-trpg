import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** 当前身份：开发期固定是演示用户，`GET /me` 顺便验证鉴权头是否生效。 */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => unwrap(await api.GET("/api/v1/me")).user,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
