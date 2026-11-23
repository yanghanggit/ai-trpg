import { Link, useParams } from "react-router";
import { describeApiError } from "../api/describeApiError";
import { readGameFacts } from "../features/games/gameState";
import { useGame } from "../features/games/useGame";

/** 局内占位页：确认「建局 → 读回」这条链路通了，真正的玩法 UI 下一阶段再做。 */
export default function GamePage() {
  const { slug = "" } = useParams();
  const game = useGame(slug);

  const facts = readGameFacts(game.data);

  return (
    <main className="launch">
      <div className="launch__inner">
        <header className="launch__header">
          <p className="launch__eyebrow">
            <Link to="/">← 入口</Link>
          </p>
          <h1>{facts.name ?? slug}</h1>
          <p className="launch__lead">
            slug：<code>{slug}</code>
          </p>
        </header>

        <section className="panel">
          {game.isPending ? <p>读取中…</p> : null}

          {game.isError ? (
            <p className="form-error" role="alert">
              {describeApiError(game.error)}
            </p>
          ) : null}

          {game.data !== undefined ? (
            <dl className="facts">
              <div>
                <dt>世界</dt>
                <dd>{facts.worldName ?? "—"}</dd>
              </div>
              <div>
                <dt>内容包</dt>
                <dd>{facts.contentKey ?? "—"}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{facts.status ?? "—"}</dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{facts.version ?? 0}</dd>
              </div>
              <div>
                <dt>舞台</dt>
                <dd>{facts.stageCount ?? 0}</dd>
              </div>
              <div>
                <dt>公共事件</dt>
                <dd>{facts.messageCount ?? 0}</dd>
              </div>
            </dl>
          ) : null}
        </section>

        {game.data !== undefined ? (
          <details className="details">
            <summary>原始 state</summary>
            <pre className="json">{JSON.stringify(game.data, null, 2)}</pre>
          </details>
        ) : null}

        <footer className="launch__footer">占位页：回合与动作尚未接入。</footer>
      </div>
    </main>
  );
}
