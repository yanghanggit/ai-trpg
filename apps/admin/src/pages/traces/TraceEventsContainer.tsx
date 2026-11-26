import { useNavigate, useParams } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { useTraceTurns, useTurnEvents } from "../../features/traces/useTraces";
import TraceEventsPage from "./TraceEventsPage";
import type { TraceEventsData } from "./types";

/** 第三层：这一回合写进文件的原始事件。 */
export default function TraceEventsContainer() {
  const navigate = useNavigate();
  const { game = "", turn = "" } = useParams();
  const events = useTurnEvents(turn);
  // 回合元信息从第二层的列表里取：同一个 queryKey，切回来不会重复请求。
  const turns = useTraceTurns({ game, limit: 500, enabled: game.length > 0 });

  const data: TraceEventsData = {
    slug: game,
    turnId: turn,
    turn: turns.data?.find((entry) => entry.turnId === turn),
    events: events.data,
    eventsError: events.isError ? describeApiError(events.error) : undefined,
  };

  return (
    <TraceEventsPage data={data} onBack={() => navigate(`/traces/${encodeURIComponent(game)}`)} />
  );
}
