import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useGames } from "../../features/games/useGames";
import { useTraceStats, useTraceTurns } from "../../features/traces/useTraces";
import TracesPage from "./TracesPage";
import type { TracesData } from "./types";

/** 列表只取最近这么多回合：够看出「最近在跑什么」，也避免首页式的长时间扫描。 */
const RECENT_TURNS = 100;

export default function TracesContainer() {
  const navigate = useNavigate();
  const stats = useTraceStats();
  const turns = useTraceTurns({ limit: RECENT_TURNS });
  const games = useGames();

  const data: TracesData = {
    stats: stats.data,
    statsError: stats.isError ? describeApiError(stats.error) : undefined,
    turns: turns.data,
    turnsError: turns.isError ? describeApiError(turns.error) : undefined,
    knownGameSlugs: new Set((games.data ?? []).map((game) => game.slug)),
  };

  return (
    <TracesPage
      data={data}
      onOpenGame={(gameRef) => navigate(`/g/${encodeURIComponent(gameRef)}`)}
      onBack={() => navigate("/")}
    />
  );
}
