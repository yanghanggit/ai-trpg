import { Link } from "react-router";
import Hint from "../../components/Hint";
import { formatAt, formatBytes, formatNumber } from "../../lib/format";
import type { TraceTurnsData, TraceTurnsHandlers } from "./types";

type Props = { data: TraceTurnsData } & TraceTurnsHandlers;

/**
 * 第二层：一个局的回合。
 *
 * 文件列表只作背景（这个局由哪几个 .jsonl 组成），主体是回合表：找「那一回合」。
 */
export default function TraceTurnsPage({ data, onOpenTurn, onBack }: Props) {
  const selected = data.games?.find((game) => game.slug === data.slug);

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
            / 局
          </p>
          <h1>
            <code>{data.slug}</code>
          </h1>
        </div>
        <p className="admin__hint">
          {selected === undefined
            ? "…"
            : `${formatNumber(selected.files.length)} 个文件 · ${formatBytes(selected.bytes)}`}
        </p>
      </header>

      <section className="panel">
        <h2>
          回合
          <Hint text="这个局的回合，最新的在前；点一行看这一回合的原始事件。" />
        </h2>

        {selected === undefined ? null : (
          <p className="muted">
            {selected.files.map((file) => `${file.name} · ${formatBytes(file.bytes)}`).join("　")}
          </p>
        )}

        {data.turns === undefined ? (
          <p className="muted">{data.turnsError ?? "读取中…"}</p>
        ) : data.turns.length === 0 ? (
          <p className="muted">这个局还没有回合。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>开始</th>
                <th>类型</th>
                <th>对象</th>
                <th>结果</th>
                <th>回合</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...data.turns].reverse().map((turn) => (
                <tr key={turn.turnId}>
                  <td>{formatAt(turn.startedAt)}</td>
                  <td>
                    <code>{turn.turnKind}</code>
                  </td>
                  <td>{turn.actorName ?? turn.stageName ?? "—"}</td>
                  <td>{resultBadge(turn.ok)}</td>
                  <td>
                    <code>{turn.turnId.slice(0, 8)}</code>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onOpenTurn(turn.turnId)}
                    >
                      事件
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function resultBadge(ok: boolean | undefined): React.ReactNode {
  if (ok === true) {
    return <span className="badge badge--ok">成功</span>;
  }
  if (ok === false) {
    return <span className="badge badge--error">失败</span>;
  }
  return <span className="badge badge--pending">未收尾</span>;
}
