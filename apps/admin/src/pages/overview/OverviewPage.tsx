import { useState } from "react";
import { formatAt, formatNumber } from "../../lib/format";
import type { OverviewData, OverviewHandlers } from "./types";

type Props = {
  data: OverviewData;
  /** 进程自身报的运行时长；容器负责换算，页面不读秒数。 */
  nodeUptime?: string;
} & OverviewHandlers;

/**
 * 总览按三层读：身份（我在用谁看）→ 节点（看的是哪台机器）→ 局（看到什么内容）。
 *
 * 顺序是刻意的：身份决定可见范围，节点决定读数的归属，局才是内容。轨迹读数不在这里——
 * 它是文件语料，跟库对不上账，属于调试口径，单独一页。
 */
export default function OverviewPage({ data, nodeUptime, onOpenGame, onOpenTraces }: Props) {
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
        <p className="admin__hint">只监听本机。运维身份看全库，玩家身份只看自己名下的局。</p>
      </header>

      <section className="panel">
        <h2>身份</h2>
        <dl className="facts">
          <div>
            <dt>用户名</dt>
            <dd>
              <code>{data.identity?.username ?? "…"}</code>
            </dd>
          </div>
          <div>
            <dt>显示名</dt>
            <dd>{data.identity?.displayName ?? "…"}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>
              {data.identity === undefined ? (
                "…"
              ) : data.identity.isAdmin ? (
                <span className="badge badge--ok">运维（可看全库）</span>
              ) : (
                <span className="badge badge--muted">仅自己名下的局</span>
              )}
            </dd>
          </div>
          <div>
            <dt>owner id</dt>
            <dd>
              <code>{data.identity?.id ?? "…"}</code>
            </dd>
          </div>
        </dl>
        <p className="muted">
          开发期身份：请求头 <code>Authorization: Bearer &lt;用户名&gt;</code>
          ，用户名即令牌，没有密码。两个身份：<code>admin</code>（运维，看全库与机器级读数）与{" "}
          <code>demo</code>（玩家，只看自己名下的局）。名单写死在服务端 <code>identity.ts</code>
          ；后台固定用 <code>admin</code>。
        </p>
        {data.identityError === undefined ? null : (
          <p className="form-error">{data.identityError}</p>
        )}
      </section>

      <section className="panel">
        <h2>节点</h2>
        <dl className="facts">
          <div>
            <dt>服务地址</dt>
            <dd>
              <code>{data.apiBaseUrl}</code>
            </dd>
          </div>
          <div>
            <dt>可达</dt>
            <dd className={badgeClass(data.healthError === undefined)}>
              {data.healthError === undefined
                ? data.health === undefined
                  ? "…"
                  : "可达"
                : "不可达"}
            </dd>
          </div>
          <div>
            <dt>往返</dt>
            <dd>{data.health === undefined ? "…" : `${data.health.latencyMs} ms`}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>
              {data.node === undefined ? "…" : `${data.node.version} / ${data.node.apiVersion}`}
            </dd>
          </div>
        </dl>

        <h3>进程</h3>
        <dl className="facts">
          <div>
            <dt>pid</dt>
            <dd>
              <code>{data.node === undefined ? "…" : String(data.node.process.pid)}</code>
            </dd>
          </div>
          <div>
            <dt>运行时</dt>
            <dd>
              {data.node === undefined
                ? "…"
                : `${data.node.process.nodeVersion} · ${data.node.process.platform}`}
            </dd>
          </div>
          <div>
            <dt>已运行</dt>
            <dd>{nodeUptime ?? "…"}</dd>
          </div>
          <div>
            <dt>监听</dt>
            <dd>
              {data.node === undefined ? "…" : `${data.node.listen.host}:${data.node.listen.port}`}
            </dd>
          </div>
        </dl>

        <h3>数据库</h3>
        {data.node === undefined ? (
          <p className="muted">{data.nodeError ?? "读取中…"}</p>
        ) : data.node.database === null ? (
          <p className="muted">连接串解析不出来，无法给出库名。</p>
        ) : (
          <dl className="facts">
            <div>
              <dt>库名</dt>
              <dd>
                <code>{data.node.database.name}</code>
              </dd>
            </div>
            <div>
              <dt>地址</dt>
              <dd>
                <code>
                  {data.node.database.host}
                  {data.node.database.port === "" ? "" : `:${data.node.database.port}`}
                </code>
              </dd>
            </div>
          </dl>
        )}

        <h3>轨迹目录</h3>
        <dl className="facts">
          <div>
            <dt>开关</dt>
            <dd>{data.node === undefined ? "…" : data.node.trace.enabled ? "写入中" : "已关闭"}</dd>
          </div>
          <div>
            <dt>目录</dt>
            <dd>
              <code>{data.node === undefined ? "…" : data.node.trace.dir}</code>
            </dd>
          </div>
          <div>
            <dt>局目录</dt>
            <dd>{data.node === undefined ? "…" : formatNumber(data.node.trace.gameDirs)}</dd>
          </div>
        </dl>
        <p className="muted">
          这三段都属于同一个进程：库是它的 <code>DATABASE_URL</code>，轨迹是它所在机器的磁盘目录；
          HTTP 与作业 worker 现在同进程（拆出去是后续选项）。所以这里看到的都是「那一台机器」，
          不是跨进程汇总。
        </p>
        {data.nodeError === undefined ? null : <p className="form-error">{data.nodeError}</p>}
      </section>

      <section className="panel">
        <h2>局</h2>
        <p className="muted">
          运维看全库（「局主」列标明每一局归谁），玩家只看自己名下的局。按更新时间倒序， slug 或
          uuid 都可以直接打开。
        </p>
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

      <section className="panel">
        <h2>轨迹</h2>
        <p className="muted">
          轨迹是文件语料，不读数据库：它记录这台机器上跑过的每个回合（含已删掉的局）， 也不按 owner
          过滤。所以它是调试口径，单独一页看。
        </p>
        <button type="button" className="button" onClick={onOpenTraces}>
          打开轨迹读数
        </button>
      </section>
    </main>
  );
}

function badgeClass(ok: boolean): string {
  return ok ? "badge badge--ok" : "badge badge--error";
}
