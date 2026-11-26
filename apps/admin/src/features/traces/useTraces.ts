import { unwrap } from "@ai-trpg/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { parseTraceStats, parseTraceTurn, type TraceStats, type TraceTurn } from "./traceIndex";

/** 列表默认取多少回合：够看清「最近发生了什么」，又不至于把首页拖慢。 */
export const TRACE_TURNS_LIMIT = 100;

/** 跨局（不传 game）或某局（传 game）的回合摘要。 */
export function useTraceTurns(options: { game?: string; limit?: number } = {}) {
  const limit = options.limit ?? TRACE_TURNS_LIMIT;
  return useQuery({
    queryKey: ["traces", options.game ?? "*", limit],
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

/** 跨回合聚合统计：回合数、LLM 用量、拒绝原因。 */
export function useTraceStats(options: { game?: string } = {}) {
  return useQuery({
    queryKey: ["traces", "stats", options.game ?? "*"],
    queryFn: async () => {
      const data = unwrap(
        await api.GET("/api/v1/traces/stats", {
          params: {
            query: options.game === undefined ? {} : { game: options.game },
          },
        }),
      );
      return parseTraceStats(data.stats);
    },
  });
}

/** 一个回合的完整事件链，展开时按需取。 */
export function useTurnEvents(turnId: string | undefined) {
  return useQuery({
    queryKey: ["traces", "turn", turnId ?? ""],
    queryFn: async () =>
      unwrap(await api.GET("/api/v1/traces/{turn}", { params: { path: { turn: turnId ?? "" } } }))
        .events,
    enabled: turnId !== undefined && turnId.length > 0,
  });
}

export type { TraceStats, TraceTurn };
