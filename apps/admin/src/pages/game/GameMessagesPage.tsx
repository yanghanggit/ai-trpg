import { Link } from "react-router";
import Hint from "../../components/Hint";
import { AUTO_REFRESH_INTERVAL_MS } from "../../features/games/useGameData";
import { formatAt } from "../../lib/format";
import type { GameMessagesData } from "./types";

type Props = {
  data: GameMessagesData;
  onToggleAutoRefresh: () => void;
  onRefresh: () => Promise<void>;
  onOpenConsole: () => void;
};

/**
 * 事件流：这一页只做一件事——把公共事件流按时间读一遍。
 *
 * 它是一屏长表，放在控制台里会把「推进」挤到折叠线以下，所以单独一页。
 */
export default function GameMessagesPage({
  data,
  onToggleAutoRefresh,
  onRefresh,
  onOpenConsole,
}: Props) {
  const messages = data.messages ?? [];

  return (
    <main className="admin">
      <header className="admin__bar">
        <div>
          <p className="eyebrow">
            <Link to="/">总览</Link> / <Link to="/games">局</Link>
          </p>
          <h1>
            <code>{data.slug}</code>
            <span className="page-kind">事件流</span>
          </h1>
        </div>
        <div className="admin__actions">
          <button
            type="button"
            className="button button--ghost"
            aria-pressed={data.autoRefresh}
            title={`每 ${AUTO_REFRESH_INTERVAL_MS / 1000} 秒重读一次`}
            onClick={onToggleAutoRefresh}
          >
            自动刷新：{data.autoRefresh ? "开" : "关"}
          </button>
          <button type="button" className="button button--ghost" onClick={() => void onRefresh()}>
            刷新
          </button>
          <button type="button" className="button button--ghost" onClick={onOpenConsole}>
            局控制台
          </button>
        </div>
      </header>

      <section className="panel">
        <h2>
          事件流
          <Hint text="公共事件流（game_messages）：上帝视角、带真实名字，只追加。新回合落地就会多一行。" />
        </h2>
        <p className="muted">共 {messages.length} 条</p>

        {data.messages === undefined ? (
          <p className="muted">{data.messagesError ?? "读取中…"}</p>
        ) : messages.length === 0 ? (
          <p className="muted">还没有事件。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>类型</th>
                <th>可见性</th>
                <th>内容</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr key={message.id}>
                  <td>{message.sequence}</td>
                  <td>{message.kind}</td>
                  <td>{message.visibility}</td>
                  <td>{message.content}</td>
                  <td>{formatAt(message.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
