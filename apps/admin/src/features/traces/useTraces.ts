import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAutoRefreshInterval } from "../autoRefresh";
import { parseTraceEvent, parseTraceTurn, type TraceEvent, type TraceTurn } from "./traceIndex";

/** 列表默认取多少回合：够看清「最近发生了什么」，又不至于把首页拖慢。 */
export const TRACE_TURNS_LIMIT = 100;

/** 某局的回合摘要；不给 `game` 时才是跨局。 */
export function useTraceTurns(options: { game?: string; limit?: number; enabled?: boolean } = {}) {
  const limit = options.limit ?? TRACE_TURNS_LIMIT;
  return useQuery({
    queryKey: ["traces", options.game ?? "*", limit],
    refetchInterval: useAutoRefreshInterval(),
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const data = unwrap(
        await api.GET("/api/v1/traces", {
          params: {
            query: {
              limit,
              ...(options.game === undefined ? {} : { game: options.game }),
            },
          },
        }),
      );
      return data.turns
        .map((raw) => parseTraceTurn(raw))
        .filter((turn): turn is TraceTurn => turn !== undefined);
    },
  });
}

/** 一个回合的完整事件链，选中时按需取。 */
export function useTurnEvents(turnId: string | undefined) {
  return useQuery({
    queryKey: ["traces", "turn", turnId ?? ""],
    queryFn: async () => {
      const data = unwrap(
        await api.GET("/api/v1/traces/{turn}", { params: { path: { turn: turnId ?? "" } } }),
      );
      return data.events
        .map((raw, index) => parseTraceEvent(raw, index))
        .filter((event): event is TraceEvent => event !== undefined);
    },
    enabled: turnId !== undefined && turnId.length > 0,
  });
}

export type { TraceEvent, TraceTurn };
