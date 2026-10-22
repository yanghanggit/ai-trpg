import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export const HEALTH_REFETCH_INTERVAL_MS = 5000;

async function fetchServerHealth() {
  const startedAt = performance.now();
  const health = unwrap(await api.GET("/api/v1/health"));
  return { health, latencyMs: Math.round(performance.now() - startedAt) };
}

/** 轮询服务端健康检查；失败时保留错误，下一次轮询会自动重试。 */
export function useServerHealth() {
  return useQuery({
    queryKey: ["server", "health"],
    queryFn: fetchServerHealth,
    refetchInterval: HEALTH_REFETCH_INTERVAL_MS,
  });
}
