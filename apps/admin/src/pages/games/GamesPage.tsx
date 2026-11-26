import { Link } from "react-router";
import Hint from "../../components/Hint";
import { formatAt, formatNumber } from "../../lib/format";
import type { GamesData, GamesHandlers } from "./types";

type Props = { data: GamesData } & GamesHandlers;

/**
 * 局列表：库里那一层内容。
 *
 * 从总览的「库名」点进来——局是库里的行，所以入口挂在库上，和「轨迹目录 → 轨迹页」同一个道理。
 * 一屏只有列表：能打开的局都已经在表里，不再另设「按引用打开」的输入框。
 */
export default function GamesPage({ data, onOpenGame, onOpenBuild, onBack }: Props) {
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
            局
            <Hint text="运维看全库（「局主」列标明归属），玩家只看自己名下的局；按更新时间倒序。「运行中作业」＝这一局此刻有没有回合作业处于排队或执行中，同一局同时只有一个。" />
          </h1>
        </div>
      </header>

      <section className="panel">
        {data.games === undefined ? null : (
          <p className="muted">共 {formatNumber(data.games.length)} 局</p>
        )}

        {data.games === undefined ? (
          <p className="muted">{data.gamesError ?? "读取中…"}</p>
        ) : data.games.length === 0 ? (
          <p className="muted">这个身份名下还没有局。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>剧本</th>
                <th>slug</th>
                <th>局主</th>
                <th>状态</th>
                <th>时刻</th>
                <th>版本</th>
                <th>运行中作业</th>
                <th>更新</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.games.map((game) => (
                <tr key={game.id}>
                  <td>{game.name}</td>
                  <td>
                    {game.worldName === null ? (
                      "—"
                    ) : (
                      <button
                        type="button"
                        className="link-button"
                        aria-label={`查看 ${game.slug} 的建局数据`}
                        onClick={() => onOpenBuild(game.slug)}
                      >
                        {game.worldName}
                      </button>
                    )}
                  </td>
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
