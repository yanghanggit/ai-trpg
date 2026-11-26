import { useState } from "react";
import { formatAt, formatNumber } from "../../lib/format";
import type { OpenGameHandler, OverviewData } from "./types";

type Props = {
  data: OverviewData;
  /** 健康检查里已格式化好的运行时长；容器负责换算，页面不读秒数。 */
  healthUptime?: string;
  onOpenGame: OpenGameHandler;
};

/** 总览：服务端是否健康、当前身份、轨迹读数，以及按 slug 打开一局。 */
export default function OverviewPage({ data, healthUptime, onOpenGame }: Props) {
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
          <p className="eyebrow">AI TRPG · admin</p>
          <h1>总览</h1>
        </div>
        <p className="admin__hint">只监听本机；读写都以当前 owner 名下的局为界。</p>
      </header>

      <section className="panel">
        <h2>服务端</h2>
        <dl className="facts">
          <div>
            <dt>状态</dt>
            <dd className={badgeClass(data.healthError === undefined)}>
              {data.healthError === undefined
                ? data.health === undefined
                  ? "…"
                  : "可达"
                : "不可达"}
            </dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>
              {data.health === undefined
                ? "…"
                : `${data.health.version} / ${data.health.apiVersion}`}
            </dd>
          </div>
          <div>
            <dt>运行时长</dt>
            <dd>{healthUptime ?? "…"}</dd>
          </div>
          <div>
            <dt>往返</dt>
            <dd>{data.health === undefined ? "…" : `${data.health.latencyMs} ms`}</dd>
          </div>
          <div>
            <dt>身份</dt>
            <dd>
              {data.identity === undefined
                ? "…"
                : `${data.identity.displayName}（${data.identity.username}）`}
            </dd>
          </div>
        </dl>
        {data.healthError !== undefined || data.identityError !== undefined ? (
          <p className="form-error">{data.healthError ?? data.identityError}</p>
        ) : null}
      </section>

      <section className="panel">
        <h2>轨迹读数</h2>
        {data.stats === undefined ? (
          <p className="muted">{data.statsError ?? "读取中…"}</p>
        ) : (
          <>
            <dl className="facts">
              <div>
                <dt>回合</dt>
                <dd>{formatNumber(data.stats.turns)}</dd>
              </div>
              <div>
                <dt>成功 / 失败</dt>
                <dd>
                  {formatNumber(data.stats.ok)} / {formatNumber(data.stats.failed)}
                </dd>
              </div>
              <div>
                <dt>模型调用</dt>
                <dd>
                  {formatNumber(data.stats.llm.calls)}
                  {data.stats.llm.errors > 0 ? `（错 ${formatNumber(data.stats.llm.errors)}）` : ""}
                </dd>
              </div>
              <div>
                <dt>token 入 / 出</dt>
                <dd>
                  {formatNumber(data.stats.llm.promptTokens)} /{" "}
                  {formatNumber(data.stats.llm.completionTokens)}
                </dd>
              </div>
            </dl>

            <h3>被拒原因</h3>
            {data.stats.rejections.length === 0 ? (
              <p className="muted">没有记录到拒绝。</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>原因</th>
                    <th>次数</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stats.rejections.slice(0, 10).map(([reason, count]) => (
                    <tr key={reason}>
                      <td>
                        <code>{reason}</code>
                      </td>
                      <td>{formatNumber(count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <h2>局</h2>
        <p className="muted">只列当前身份名下的局，按更新时间倒序。slug 或 uuid 都可以直接打开。</p>
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

function badgeClass(ok: boolean): string {
  return ok ? "badge badge--ok" : "badge badge--error";
}
