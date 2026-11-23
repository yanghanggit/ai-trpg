/**
 * mock 入口（`pnpm dev:mock` → mock.html）。
 *
 * 这个文件在生产构建图之外：`index.html` 不引用它，rollup 的输入只有 `index.html`。
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "../index.css";
import "./mock.css";
import Host from "./Host";
import MockIndex from "./MockIndex";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("找不到 #root 挂载点");
}

const queryClient = new QueryClient();

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MockIndex />} />
          <Route path="/p/:key" element={<Host />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
