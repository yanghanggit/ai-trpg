#!/usr/bin/env node
/**
 * mock 隔离守卫：正式客户端的构建图里不能出现 mock 目录。
 *
 * 判据是 import 图而不是运行时开关：`index.html` 只加载 `src/main.tsx`，
 * 只要 `src/` 下（除 `src/mock/` 与测试文件）没人 import `mock/`，产物里就不会有它。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const webDir = path.join(root, "apps/web");
const srcDir = path.join(webDir, "src");
const mockDir = path.join(srcDir, "mock");

const violations = [];

function isInsideMock(absolutePath) {
  return absolutePath === mockDir || absolutePath.startsWith(`${mockDir}${path.sep}`);
}

function listFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) {
      return listFiles(absolute);
    }
    return [absolute];
  });
}

function importsOf(source) {
  return [...source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

for (const file of listFiles(srcDir)) {
  if (isInsideMock(file)) {
    continue;
  }
  // 测试与 mock 一起生活是允许的：测试不进产物。
  if (/\.test\.(?:ts|tsx)$/.test(file)) {
    continue;
  }
  if (!/\.(?:ts|tsx)$/.test(file)) {
    continue;
  }

  const source = readFileSync(file, "utf8");
  for (const specifier of importsOf(source)) {
    if (!specifier.startsWith(".")) {
      continue;
    }
    const resolved = path.resolve(path.dirname(file), specifier);
    if (isInsideMock(resolved) || specifier.includes("mock/")) {
      violations.push(`${path.relative(root, file)} → ${specifier}`);
    }
  }
}

const indexHtml = readFileSync(path.join(webDir, "index.html"), "utf8");
if (indexHtml.includes("mock")) {
  violations.push("apps/web/index.html 引用了 mock");
}

if (violations.length > 0) {
  console.error("❌ 正式入口引用了 mock 目录（mock 只能在 mock.html 里加载）：");
  for (const violation of violations) {
    console.error(`   ${violation}`);
  }
  process.exit(1);
}

console.log("✅ mock 隔离检查通过（正式入口不引用 src/mock）");
