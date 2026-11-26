import { useState } from "react";
import Hint from "../../components/Hint";
import { formatAt, formatNumber } from "../../lib/format";
import type { GamesData, GamesHandlers } from "./types";

type Props = { data: GamesData } & GamesHandlers;

/**
 * 局列表：库里那一层内容。
 *
 * 从总览的「库名」点进来——局是库里的行，所以入口挂在库上，和「轨迹目录 → 轨迹页」同一个道理。
 * 「按引用打开」是寻址，不是读数，所以折叠起来：默认这一屏只有列表。
 */
export default function GamesPage({ data, onOpenGame, onBack }: Props) {
  const [gameRef, setGameRef] = useState("");
  const trimmed = gameRef.trim();

  function handleOpen(event: React.FormEvent) {
    event.preventDefault();
    if (trimmed.length > 0) {
      onOpenGame(trimmed);
    }
  }

  return (
    <main className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">
            <a href="/" onClick={stopThen(onBack)}>
              ← 总览
            </a>
          </p>
          <h1>
            局
            <Hint text="运维看全库（「局主」列标明归属），玩家只看自己名下的局；按更新时间倒序。" />
          </h1>
        </div>
        <p className="admin__hint">
          共 {data.games === undefined ? "…" : formatNumber(data.games.length)} 局
        </p>
      </header>

      <section className="panel">
        <details className="details">
          <summary>按引用打开一局</summary>
          <form className="inline-form" onSubmit={handleOpen}>
            <label className="field">
              <span>局引用</span>
              <input
                value={gameRef}
                onChange={(event) => setGameRef(event.target.value)}
                placeholder="bell-monastery 或 uuid"
                autoComplete="off"
              />
            </label>
            <button className="button" type="submit" disabled={trimmed.length === 0}>
              打开
            </button>
          </form>
        </details>

        {data.games === undefined ? (
          <p className="muted">{data.gamesError ?? "读取中…"}</p>
        ) : data.games.length === 0 ? (
          <p className="muted">这个身份名下还没有局。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>slug</th>
                <th>局主</th>
                <th>状态</th>
                <th>时刻</th>
                <th>版本</th>
                <th>在跑</th>
                <th>更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.games.map((game) => (
                <tr key={game.id}>
                  <td>{game.name}</td>
                  <td>
                    <code>{game.slug}</code>
                  </td>
                  <td>
                    <code>{game.ownerUsername}</code>
                  </td>
                  <td>
                    {game.outcome === null ? game.status : `${game.status} · ${game.outcome}`}
                  </td>
                  <td>{formatNumber(game.clock)}</td>
                  <td>{formatNumber(game.version)}</td>
                  <td>
                    {game.activeJob === null ? (
                      "—"
                    ) : (
                      <span className="badge badge--pending">
                        {game.activeJob.kind} · {game.activeJob.status}
                      </span>
                    )}
                  </td>
                  <td>{formatAt(game.updatedAt)}</td>
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

/** 页内返回既走路由也要挡掉默认跳转，避免整页刷新丢掉缓存。 */
function stopThen(handler: () => void): (event: React.MouseEvent) => void {
  return (event) => {
    event.preventDefault();
    handler();
  };
}
