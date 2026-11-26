import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useGames } from "../../features/games/useGames";
import { formatUptime } from "../../features/health/formatUptime";
import { useServerHealth } from "../../features/health/useServerHealth";
import { useMe } from "../../features/identity/useMe";
import { useTraceStats } from "../../features/traces/useTraces";
import OverviewPage from "./OverviewPage";
import type { OverviewData } from "./types";

/** 取数都在这里；`OverviewPage` 只负责渲染。 */
export default function OverviewContainer() {
  const navigate = useNavigate();
  const health = useServerHealth();
  const me = useMe();
  const stats = useTraceStats();
  const games = useGames();

  const data: OverviewData = {
    health:
      health.data === undefined
        ? undefined
        : {
            version: health.data.health.version,
            apiVersion: health.data.health.apiVersion,
            uptimeSeconds: health.data.health.uptimeSeconds,
            latencyMs: health.data.latencyMs,
          },
    healthError: health.isError ? describeApiError(health.error) : undefined,
    identity:
      me.data === undefined
        ? undefined
        : { username: me.data.username, displayName: me.data.displayName },
    identityError: me.isError ? describeApiError(me.error) : undefined,
    stats: stats.data,
    statsError: stats.isError ? describeApiError(stats.error) : undefined,
    games: games.data,
    gamesError: games.isError ? describeApiError(games.error) : undefined,
  };

  return (
    <OverviewPage
      data={data}
      healthUptime={
        health.data === undefined ? undefined : formatUptime(health.data.health.uptimeSeconds)
      }
      onOpenGame={(gameRef) => navigate(`/g/${encodeURIComponent(gameRef)}`)}
    />
  );
}
