import { useState } from "react";
import PageHeader from "../../components/PageHeader";
import type { GameSummary } from "../../features/games/useGames";
import { formatAt, formatNumber } from "../../lib/format";
import DeleteGameDialog from "./DeleteGameDialog";
import type { GamesData, GamesHandlers } from "./types";

type Props = { data: GamesData } & GamesHandlers;

/**
 * 局列表：库里那一层内容。
 *
 * 从总览的「库名」点进来——局是库里的行，所以入口挂在库上，和「轨迹目录 → 轨迹页」同一个道理。
 * 一屏只有列表：能打开的局都已经在表里，不再另设「按引用打开」的输入框。
 *
 * 删除也在这里：它是「这一局不该存在了」，只有在看得见全部局的一页才答得准是哪一局。
 */
export default function GamesPage({ data, onOpenGame, onOpenBuild, onDelete, onRefresh }: Props) {
  // 正在确认删除的那一行：视图状态，不进地址栏。
  const [deleting, setDeleting] = useState<GameSummary>();

  return (
    <main className="admin">
      <PageHeader
        crumbs={[{ label: "总览", to: "/" }, { label: "局" }]}
        title="局"
        hint="运维看全库（「局主」列标明归属），玩家只看自己名下的局；按更新时间倒序。这一局此刻在跑什么作业，进控制台看。"
        onRefresh={onRefresh}
      />

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
                  <td>{formatAt(game.updatedAt)}</td>
                  <td className="games__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onOpenGame(game.slug)}
                    >
                      控制台
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--danger"
                      onClick={() => setDeleting(game)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {deleting === undefined ? null : (
        <DeleteGameDialog
          game={deleting}
          onClose={() => setDeleting(undefined)}
          onDelete={onDelete}
        />
      )}
    </main>
  );
}

/** 页内返回既走路由也要挡掉默认跳转，避免整页刷新丢掉缓存。 */
