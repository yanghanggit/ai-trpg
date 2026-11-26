import { useNavigate } from "react-router";
import { apiBaseUrl } from "../../api/client";
import { describeApiError } from "../../api/describeApiError";
import { useGames } from "../../features/games/useGames";
import { formatUptime } from "../../features/health/formatUptime";
import { useServerHealth } from "../../features/health/useServerHealth";
import { useMe } from "../../features/identity/useMe";
import { useNodeStatus } from "../../features/node/useNodeStatus";
import OverviewPage from "./OverviewPage";
import type { OverviewData } from "./types";

/** 取数都在这里；`OverviewPage` 只负责渲染。 */
export default function OverviewContainer() {
  const navigate = useNavigate();
  const health = useServerHealth();
  const me = useMe();
  const node = useNodeStatus();
  const games = useGames();

  const data: OverviewData = {
    identity:
      me.data === undefined
        ? undefined
        : {
            id: me.data.id,
            username: me.data.username,
            displayName: me.data.displayName,
            isAdmin: me.data.isAdmin,
          },
    identityError: me.isError ? describeApiError(me.error) : undefined,
    node: node.data,
    nodeError: node.isError ? describeApiError(node.error) : undefined,
    health: health.data === undefined ? undefined : { latencyMs: health.data.latencyMs },
    healthError: health.isError ? describeApiError(health.error) : undefined,
    games: games.data,
    gamesError: games.isError ? describeApiError(games.error) : undefined,
    apiBaseUrl,
  };

  return (
    <OverviewPage
      data={data}
      nodeUptime={
        node.data === undefined ? undefined : formatUptime(node.data.process.uptimeSeconds)
      }
      onOpenGame={(gameRef) => navigate(`/g/${encodeURIComponent(gameRef)}`)}
      onOpenTraces={() => navigate("/traces")}
    />
  );
}
