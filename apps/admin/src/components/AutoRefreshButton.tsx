import { AUTO_REFRESH_INTERVAL_MS, useAutoRefresh } from "../features/autoRefresh";

/**
 * 自动刷新开关：页头右侧固定位置，切页不跳。
 *
 * 它管的是这一页的读数要不要按 5 秒重读；关掉后只剩右边那个「刷新」。
 */
export default function AutoRefreshButton() {
  const { enabled, toggle } = useAutoRefresh();
  return (
    <button
      type="button"
      className="button button--ghost"
      aria-pressed={enabled}
      title={`开着时每 ${AUTO_REFRESH_INTERVAL_MS / 1000} 秒重读这一页的读数`}
      onClick={toggle}
    >
      自动刷新：{enabled ? "开" : "关"}
    </button>
  );
}
