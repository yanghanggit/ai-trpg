/// <reference types="vitest/config" />

import { fileURLToPath } from "node:url";
import { DEFAULT_WEB_PORT } from "@ai-trpg/shared";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// 仓库根目录：server / web 共用同一份 .env。
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const port = Number(env.VITE_DEV_PORT ?? DEFAULT_WEB_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`VITE_DEV_PORT 不是合法端口：${env.VITE_DEV_PORT}`);
  }

  return {
    envDir: repoRoot,
    plugins: [react()],
    server: {
      // 监听 0.0.0.0，局域网内其他设备可直接访问。
      host: true,
      port,
      // 被占用就直接失败，不静默顺延到别的端口。
      strictPort: true,
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
