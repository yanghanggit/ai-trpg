import { Link } from "react-router";
import Hint from "../../components/Hint";
import { formatAt, formatBytes, formatNumber } from "../../lib/format";
import type { TracesData, TracesHandlers } from "./types";

type Props = { data: TracesData } & TracesHandlers;

/**
 * 第一层：`logs/trace` 下有哪些局。
 *
 * 一屏只做一件事——找局。回合与事件各自一屏，这里不预览任何内容。
 */
export default function TracesPage({ data, onOpenGame, onBack }: Props) {
  return (
    <main className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">
            <Link to="/" onClick={onBack}>
              总览
            </Link>
          </p>
          <h1>
            轨迹
            <Hint text="logs/trace 的只读阅览器：这一屏是局目录，点进去看它的回合，再点一个回合看原始事件。文件不读数据库，也不按 owner 过滤。" />
          </h1>
        </div>
      </header>

      <section className="panel">
        <h2>
          目录
          <Hint text="每个局一个文件夹，一天一个 .jsonl（旧的会压成 .gz）。按最近写入排序。" />
        </h2>
        <p className="muted">
          <code>{data.dir ?? "…"}</code>
        </p>

        {data.games === undefined ? (
          <p className="muted">{data.gamesError ?? "读取中…"}</p>
        ) : data.games.length === 0 ? (
          <p className="muted">这个目录下还没有任何局。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>局</th>
                <th>文件</th>
                <th>大小</th>
                <th>最近写入</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.games.map((game) => (
                <tr key={game.slug}>
                  <td>
                    <code>{game.slug}</code>
                  </td>
                  <td>{formatNumber(game.files.length)}</td>
                  <td>{formatBytes(game.bytes)}</td>
                  <td>{formatAt(game.lastAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onOpenGame(game.slug)}
                    >
                      打开
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
