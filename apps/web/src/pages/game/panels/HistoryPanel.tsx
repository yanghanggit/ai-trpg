import { describeApiError } from "../../../api/describeApiError";
import type { GameMessage } from "../../../features/games/useGameMessages";

/** 事件流的状态与增量入口；取数在容器里，面板只认这份形状。 */
export type HistoryState = {
  items: GameMessage[];
  total: number;
  hasMore: boolean;
  loadMore: () => void;
  loading: boolean;
  loadingMore: boolean;
  error?: unknown;
};

/** 全上下文事件流：按序号正序，越往下越新。 */
export default function HistoryPanel({ history }: { history: HistoryState }) {
  if (history.error !== undefined) {
    return (
      <p className="form-error" role="alert">
        {describeApiError(history.error)}
      </p>
    );
  }

  if (history.loading) {
    return <p className="muted">读取中…</p>;
  }

  if (history.items.length === 0) {
    return <p className="muted">还没有任何事件。</p>;
  }

  return (
    <>
      <ol className="entries">
        {history.items.map((message) => (
          <li key={message.id}>
            <span className="entries__kind">
              #{message.sequence} · {message.kind}
            </span>
            {message.content}
          </li>
        ))}
      </ol>

      <footer className="sheet__footer">
        <span className="muted">
          已载入 {history.items.length} / {history.total} 条
        </span>
        {history.hasMore ? (
          <button
            type="button"
            className="button button--ghost"
            onClick={history.loadMore}
            disabled={history.loadingMore}
          >
            {history.loadingMore ? "读取中…" : "加载更多"}
          </button>
        ) : null}
      </footer>
    </>
  );
}
