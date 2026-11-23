import { Link } from "react-router";
import type { GamePageData } from "./types";

/** 局内占位页：只吃数据，不发请求。fixture 与真 API 都通过它渲染。 */
export default function GamePage({ data }: { data: GamePageData }) {
  return (
    <main className="launch">
      <div className="launch__inner">
        <header className="launch__header">
          <p className="launch__eyebrow">
            <Link to="/">← 入口</Link>
          </p>
          <h1>{data.name ?? data.slug}</h1>
          <p className="launch__lead">
            slug：<code>{data.slug}</code>
          </p>
        </header>

        <section className="panel">
          <dl className="facts">
            <div>
              <dt>世界</dt>
              <dd>{data.worldName ?? "—"}</dd>
            </div>
            <div>
              <dt>内容包</dt>
              <dd>{data.contentKey ?? "—"}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{data.status ?? "—"}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{data.version ?? 0}</dd>
            </div>
            <div>
              <dt>舞台</dt>
              <dd>{data.stages.length}</dd>
            </div>
            <div>
              <dt>公共事件</dt>
              <dd>{data.messageCount}</dd>
            </div>
          </dl>

          {data.stages.length > 0 ? (
            <ul className="chips">
              {data.stages.map((stage) => (
                <li key={stage} className="chip">
                  {stage}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">这局还没有舞台。</p>
          )}
        </section>

        <footer className="launch__footer">占位页：回合与动作尚未接入。</footer>
      </div>
    </main>
  );
}
