import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    // 测试不写过程轨迹：.env 里的 TRACE_ENABLED 会压过 NODE_ENV 判断，所以在进程级显式关掉。
    env: { TRACE_ENABLED: "false" },
  },
});
