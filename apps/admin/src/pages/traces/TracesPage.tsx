import { formatAt, formatNumber } from "../../lib/format";
import type { TracesData, TracesHandlers } from "./types";

type Props = { data: TracesData } & TracesHandlers;

/**
 * 轨迹读数：读的是 `logs/trace` 下的文件语料，不是数据库。
 *
 * 页面第一屏就先说清楚它能回答什么、不能回答什么——否则「245 回合」很容易被当成
 * 「库里现在有 245 个回合」。三个口径差异写在面板里，和数字放在一起。
 */
export default function TracesPage({ data, onOpenGame, onBack }: Props) {
  const untracked =
    data.stats === undefined ? undefined : data.stats.turns - data.stats.ok - data.stats.failed;

  return (
    <main className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">
            <a href="/" onClick={stopThen(onBack)}>
              ← 总览
            </a>
          </p>
          <h1>轨迹</h1>
        </div>
        <p className="admin__hint">调试口径：读文件，不读库；跨所有局，不按 owner 过滤。</p>
      </header>

      <section className="panel">
        <h2>口径</h2>
        <dl className="facts">
          <div>
            <dt>数据来源</dt>
            <dd>
              <code>logs/trace/&lt;slug&gt;/&lt;YYYYMMDD&gt;.jsonl</code>
            </dd>
          </div>
          <div>
            <dt>覆盖范围</dt>
            <dd>这台机器上跑过的所有回合</dd>
          </div>
          <div>
            <dt>与数据库</dt>
            <dd>无关联：已删掉的局仍在，重置过的库对不上</dd>
          </div>
          <div>
            <dt>清理</dt>
            <dd>
              手动 <code>agent:api trace gc</code>
            </dd>
          </div>
        </dl>
        <p className="muted">
          所以这里的「回合数」是历史账本，不是「库里现在有多少局、多少回合」。要判断某一局好不好，
          去局控制台看那一局的轨迹。
        </p>
      </section>

      <section className="panel">
        <h2>读数</h2>
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
                <dt>未收尾</dt>
                <dd>{untracked === undefined ? "…" : formatNumber(untracked)}</dd>
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
            <p className="muted">
              「未收尾」是成功与失败都算不上的回合：进程被杀、作业超时、或者崩在收尾之前。
              它不写进成功也不写进失败，所以必须单独列出来，否则差额只能靠减法猜。
            </p>

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
                  {data.stats.rejections.map(([reason, count]) => (
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
        <h2>最近回合</h2>
        <p className="muted">
          最近 100 轮，最新在前。库里还在的局可以点进去；已删掉的局只留在这里，不提供跳转。
        </p>
        {data.turns === undefined ? (
          <p className="muted">{data.turnsError ?? "读取中…"}</p>
        ) : data.turns.length === 0 ? (
          <p className="muted">还没有轨迹：推进一个回合之后才会写文件。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>局</th>
                <th>类型</th>
                <th>对象</th>
                <th>开始</th>
                <th>结果</th>
                <th>模型</th>
                <th>token 入 / 出</th>
              </tr>
            </thead>
            <tbody>
              {[...data.turns].reverse().map((turn) => (
                <tr key={turn.turnId}>
                  <td>
                    {data.knownGameSlugs.has(turn.gameSlug) ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => onOpenGame(turn.gameSlug)}
                      >
                        {turn.gameSlug}
                      </button>
                    ) : (
                      <code>{turn.gameSlug}</code>
                    )}
                  </td>
                  <td>
                    <code>{turn.turnKind}</code>
                  </td>
                  <td>{turn.actorName ?? turn.stageName ?? "—"}</td>
                  <td>{formatAt(turn.startedAt)}</td>
                  <td>{resultBadge(turn.ok)}</td>
                  <td>
                    {formatNumber(turn.llmCalls)}
                    {turn.llmErrors > 0 ? `（错 ${formatNumber(turn.llmErrors)}）` : ""}
                  </td>
                  <td>
                    {formatNumber(turn.promptTokens)} / {formatNumber(turn.completionTokens)}
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

/** 页内的返回既走路由也要挡掉默认跳转，避免整页刷新丢掉缓存。 */
function stopThen(handler: () => void): (event: React.MouseEvent) => void {
  return (event) => {
    event.preventDefault();
    handler();
  };
}
