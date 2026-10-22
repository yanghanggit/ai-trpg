import { apiBaseUrl } from "../../api/client";
import { describeApiError } from "../../api/describeApiError";
import { formatUptime } from "./formatUptime";
import { HEALTH_REFETCH_INTERVAL_MS, useServerHealth } from "./useServerHealth";

const REFETCH_SECONDS = HEALTH_REFETCH_INTERVAL_MS / 1000;

export default function ServerConnectionCard() {
  const { data, error, isPending, isError, isFetching, refetch, dataUpdatedAt } = useServerHealth();

  const status = isPending ? "pending" : isError ? "error" : "ok";
  const statusLabel = { pending: "连接中…", error: "连接失败", ok: "已连接" }[status];

  return (
    <section className="connection-card">
      <header className="connection-card__header">
        <div>
          <h2>服务端连接</h2>
          <p className="connection-card__endpoint">{apiBaseUrl}</p>
        </div>
        <span className={`badge badge--${status}`}>{statusLabel}</span>
      </header>

      {isPending ? <p className="connection-card__hint">正在请求 /api/v1/health…</p> : null}

      {isError ? (
        <div className="connection-card__error" role="alert">
          <p>{describeApiError(error)}</p>
          <p className="connection-card__hint">
            启动服务端：<code>pnpm dev:server</code>
          </p>
        </div>
      ) : null}

      {data ? (
        <dl className="connection-card__facts">
          <div>
            <dt>服务</dt>
            <dd>{data.health.service}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{data.health.version}</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd>{data.health.apiVersion}</dd>
          </div>
          <div>
            <dt>运行时长</dt>
            <dd>{formatUptime(data.health.uptimeSeconds)}</dd>
          </div>
          <div>
            <dt>延迟</dt>
            <dd>{data.latencyMs} ms</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>{new Date(dataUpdatedAt).toLocaleTimeString("zh-CN")}</dd>
          </div>
        </dl>
      ) : null}

      <footer className="connection-card__footer">
        <button type="button" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? "刷新中…" : "立即重试"}
        </button>
        <span>每 {REFETCH_SECONDS} 秒自动刷新</span>
      </footer>
    </section>
  );
}
