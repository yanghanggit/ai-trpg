import { Link } from "react-router";
import Hint from "../../components/Hint";
import { formatAt } from "../../lib/format";
import type { TraceEventsData, TraceEventsHandlers } from "./types";

type Props = { data: TraceEventsData } & TraceEventsHandlers;

/**
 * 第三层：一个回合的原始事件。
 *
 * 一屏只读这一回合：每条一行，展开就是那行 JSON。这里不重排、不折叠语义——
 * 想看人读版本用 `agent:api trace render`。
 */
export default function TraceEventsPage({ data, onBack }: Props) {
  return (
    <main className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">
            <Link to="/" onClick={onBack}>
              总览
            </Link>{" "}
            /{" "}
            <Link to="/traces" onClick={onBack}>
              轨迹
            </Link>{" "}
            /{" "}
            <Link
              className="eyebrow__ref"
              to={`/traces/${encodeURIComponent(data.slug)}`}
              onClick={onBack}
            >
              {data.slug}
            </Link>
          </p>
          <h1>
            <code>{data.turnId.slice(0, 8)}</code>
            <span className="page-kind">事件</span>
          </h1>
        </div>
      </header>

      <section className="panel">
        <h2>
          事件
          <Hint text="这一回合写进文件的原始行，保持文件顺序：事件名 + 时间，展开是整行 JSON。" />
        </h2>
        <p className="muted">
          {data.turn === undefined
            ? "…"
            : `${data.turn.turnKind} · ${data.turn.actorName ?? data.turn.stageName ?? "—"} · ${formatAt(data.turn.startedAt)}`}
        </p>

        {data.events === undefined ? (
          <p className="muted">{data.eventsError ?? "读取中…"}</p>
        ) : data.events.length === 0 ? (
          <p className="muted">这个回合没有事件。</p>
        ) : (
          data.events.map((event) => (
            <details className="details" key={event.seq}>
              <summary>
                <code>{event.event}</code> · {formatAt(event.at)}
              </summary>
              <pre className="json">{JSON.stringify(event.raw, null, 2)}</pre>
            </details>
          ))
        )}
      </section>
    </main>
  );
}
