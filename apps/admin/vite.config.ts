/// <reference types="vitest/config" />

import { fileURLToPath } from "node:url";
import { DEFAULT_ADMIN_PORT } from "@ai-trpg/shared";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// 仓库根目录：server / web / admin 共用同一份 .env。
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const port = Number(env.VITE_ADMIN_PORT ?? DEFAULT_ADMIN_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`VITE_ADMIN_PORT 不是合法端口：${env.VITE_ADMIN_PORT}`);
  }

  return {
    envDir: repoRoot,
    plugins: [react()],
    server: {
      // 后台只服务本机：它读的是全知视图，不该出现在局域网里。
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
    preview: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
    test: {
      // 后台的页面测试会连服务端，这里只测纯函数，不引 jsdom。
      environment: "node",
      globals: true,
    },
  };
});
