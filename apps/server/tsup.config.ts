import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // workspace 包导出的是 TS 源码，必须打进产物，不能当外部依赖。
  noExternal: [/^@ai-trpg\//],
});
