import type { GameSummary } from "../../features/games/useGames";
import type { TraceStats } from "../../features/traces/traceIndex";

/** 总览页只吃这一份数据；取数、聚合与跳转都在容器里。 */
export type OverviewData = {
  health?: {
    version: string;
    apiVersion: string;
    uptimeSeconds: number;
    latencyMs: number;
  };
  healthError?: string;
  identity?: { username: string; displayName: string };
  identityError?: string;
  stats?: TraceStats;
  statsError?: string;
  /** 当前身份名下的局，按更新时间倒序。 */
  games?: GameSummary[];
  gamesError?: string;
};

export type OpenGameHandler = (gameRef: string) => void;
