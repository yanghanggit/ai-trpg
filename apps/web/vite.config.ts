/// <reference types="vitest/config" />

import { fileURLToPath } from "node:url";
import { DEFAULT_MOCK_PORT, DEFAULT_WEB_PORT } from "@ai-trpg/shared";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * mock 入口的 SPA 回退：`/` 与 `/p/*` 都由 mock.html 承接。
 *
 * 默认的 spa 回退会把这些路径交给 index.html（正式端），深链接就会打开错的入口；
 * 这里只在 `--mode mock` 下挂，正式 dev 与 build 都不受影响。
 */
function mockEntryPlugin(): Plugin {
  return {
    name: "ai-trpg-mock-entry",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = request.url ?? "/";
        if (url === "/" || url.startsWith("/p/") || url.startsWith("/p?")) {
          request.url = "/mock.html";
        }
        next();
      });
    },
  };
}

// 仓库根目录：server / web 共用同一份 .env。
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");

  /**
   * `--mode mock` 起的是页面目录：独立端口、独立入口，生产构建的输入仍然只有 index.html，
   * 所以 mock 那棵树（mock.html 与 src/mock/）物理上进不了产物。
   */
  const isMock = mode === "mock";
  const portVar = isMock ? "VITE_MOCK_PORT" : "VITE_DEV_PORT";
  const port = Number(env[portVar] ?? (isMock ? DEFAULT_MOCK_PORT : DEFAULT_WEB_PORT));

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${portVar} 不是合法端口：${env[portVar]}`);
  }

  return {
    envDir: repoRoot,
    plugins: isMock ? [react(), mockEntryPlugin()] : [react()],
    server: {
      // 监听 0.0.0.0，局域网内其他设备可直接访问。
      host: true,
      port,
      // 被占用就直接失败，不静默顺延到别的端口。
      strictPort: true,
      open: isMock ? "/mock.html" : undefined,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
