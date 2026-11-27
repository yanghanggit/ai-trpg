import Hint from "../../components/Hint";
import PageHeader from "../../components/PageHeader";
import { formatNumber } from "../../lib/format";
import type { OverviewData, OverviewHandlers } from "./types";

type Props = {
  data: OverviewData;
  /** 进程自身报的运行时长；容器负责换算，页面不读秒数。 */
  nodeUptime?: string;
} & OverviewHandlers;

/**
 * 总览只回答两件事：我在用谁看（身份）、看的是哪台机器（节点）。
 *
 * 内容不在这里：库名点进「局」，轨迹目录点进「轨迹」。两条入口都挂在节点上，因为
 * 局是那台机器库里的行、轨迹是那台机器的磁盘——它们属于宿主，不属于这一屏。
 */
export default function OverviewPage({ data, nodeUptime, onOpenGames, onOpenTraces }: Props) {
  return (
    <main className="admin">
      <PageHeader crumbs={[]} title="总览" />

      <section className="panel">
        <h2>
          身份
          <Hint text="开发期没有登录：请求头 Bearer <用户名>，用户名即令牌，没有密码。admin 是运维（看全库与机器级读数），demo 是玩家（只看自己名下的局）；名单写死在服务端 identity.ts，后台固定用 admin。" />
        </h2>
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
        {data.identityError === undefined ? null : (
          <p className="form-error">{data.identityError}</p>
        )}
      </section>

      <section className="panel">
        <h2>
          节点
          <Hint text="三个子块都属于同一个服务端进程：库来自它的 DATABASE_URL，轨迹目录在它所在的机器上，HTTP 与作业 worker 同进程。这里是「那一台机器」，不是多进程汇总。" />
        </h2>
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

        <h3>
          数据库
          <Hint text="库名是这一台机器的数据源；点进去是库里的局。运维看全库，玩家只看自己名下的。" />
        </h3>
        {data.node === undefined ? (
          <p className="muted">{data.nodeError ?? "读取中…"}</p>
        ) : data.node.database === null ? (
          <p className="muted">连接串解析不出来，无法给出库名。</p>
        ) : (
          <dl className="facts">
            <div>
              <dt>库名</dt>
              <dd>
                <button
                  type="button"
                  className="link-button"
                  aria-label="打开局列表"
                  onClick={onOpenGames}
                >
                  <code>{data.node.database.name}</code>
                </button>
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

        <h3>
          轨迹目录
          <Hint text="文件语料，不读数据库：记录这台机器跑过的所有回合（含已删掉的局），不按 owner 过滤。属于调试口径，单独一页看。" />
        </h3>
        <dl className="facts">
          <div>
            <dt>开关</dt>
            <dd>{data.node === undefined ? "…" : data.node.trace.enabled ? "写入中" : "已关闭"}</dd>
          </div>
          <div>
            <dt>目录</dt>
            <dd>
              {data.node === undefined ? (
                "…"
              ) : (
                <button
                  type="button"
                  className="link-button"
                  aria-label="打开轨迹读数"
                  onClick={onOpenTraces}
                >
                  <code>{data.node.trace.dir}</code>
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt>局目录</dt>
            <dd>{data.node === undefined ? "…" : formatNumber(data.node.trace.gameDirs)}</dd>
          </div>
        </dl>
        {data.nodeError === undefined ? null : <p className="form-error">{data.nodeError}</p>}
      </section>
    </main>
  );
}

function badgeClass(ok: boolean): string {
  return ok ? "badge badge--ok" : "badge badge--error";
}
