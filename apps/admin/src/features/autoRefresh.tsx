import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

/** 自动重读间隔：只在页面看得见时生效，关掉就完全靠手动「刷新」。 */
export const AUTO_REFRESH_INTERVAL_MS = 5000;

type AutoRefreshValue = {
  enabled: boolean;
  toggle: () => void;
};

const AutoRefreshContext = createContext<AutoRefreshValue>({
  enabled: true,
  toggle: () => {},
});

/**
 * 全局的「自动刷新」开关。
 *
 * 它管的是「当前这一页的读数要不要按 5 秒重读」，所以放在页面顶层而不是某个列表里：
 * 按钮常驻在页头同一个位置，切页也不跳。
 */
export function AutoRefreshProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true);
  const value = useMemo<AutoRefreshValue>(
    () => ({ enabled, toggle: () => setEnabled((current) => !current) }),
    [enabled],
  );
  return <AutoRefreshContext.Provider value={value}>{children}</AutoRefreshContext.Provider>;
}

export function useAutoRefresh(): AutoRefreshValue {
  return useContext(AutoRefreshContext);
}

/** 给 `useQuery` 用：开着就是 5 秒一次，关掉就是 `false`（不轮询）。 */
export function useAutoRefreshInterval(): number | false {
  return useAutoRefresh().enabled ? AUTO_REFRESH_INTERVAL_MS : false;
}
