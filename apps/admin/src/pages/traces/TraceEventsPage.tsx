import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { formatAt } from "../../lib/format";
import type { TraceEventsData } from "./types";

type Props = { data: TraceEventsData; onRefresh: () => void };

/**
 * 第三层：一个回合的原始事件。
 *
 * 一屏只读这一回合：每条一行，展开就是那行 JSON。这里不重排、不折叠语义——
 * 想看人读版本用 `agent:api trace render`。
 */
export default function TraceEventsPage({ data, onRefresh }: Props) {
  return (
    <main className="admin">
      <PageHeader
        crumbs={[
          { label: "总览", to: "/" },
          { label: "轨迹", to: "/traces" },
          { label: data.slug, to: `/traces/${encodeURIComponent(data.slug)}` },
          { label: "事件" },
        ]}
        title={<code>{data.turnId.slice(0, 8)}</code>}
        onRefresh={onRefresh}
      />

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
