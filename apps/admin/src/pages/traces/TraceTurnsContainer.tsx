import { useNavigate, useParams } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useTraceFiles } from "../../features/traces/useTraceFiles";
import { useTraceTurns } from "../../features/traces/useTraces";
import TraceTurnsPage from "./TraceTurnsPage";
import type { TraceTurnsData } from "./types";

/** 一局最多读这么多回合：阅览器按局读，不做跨局聚合。 */
const TURNS_LIMIT = 500;

/** 第二层：这个局有哪些文件、哪些回合。 */
export default function TraceTurnsContainer() {
  const navigate = useNavigate();
  const { game = "" } = useParams();
  const files = useTraceFiles();
  const turns = useTraceTurns({ game, limit: TURNS_LIMIT, enabled: game.length > 0 });

  const data: TraceTurnsData = {
    slug: game,
    games: files.data?.games,
    gamesError: files.isError ? describeApiError(files.error) : undefined,
    turns: turns.data,
    turnsError: turns.isError ? describeApiError(turns.error) : undefined,
  };

  return (
    <TraceTurnsPage
      data={data}
      onOpenTurn={(turnId) =>
        navigate(`/traces/${encodeURIComponent(game)}/${encodeURIComponent(turnId)}`)
      }
      onBack={() => navigate("/traces")}
    />
  );
}
