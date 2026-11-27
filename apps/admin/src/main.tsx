import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { shouldRetry } from "./api/queryPolicy";
import { AutoRefreshProvider } from "./features/autoRefresh";
// 图谱库自己的样式先进来，index.css 覆盖它（它在 @layer xyflow 里，普通 CSS 优先）。
import "@xyflow/react/style.css";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("找不到 #root 挂载点");
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetry } },
});

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AutoRefreshProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AutoRefreshProvider>
    </QueryClientProvider>
  </StrictMode>,
);
