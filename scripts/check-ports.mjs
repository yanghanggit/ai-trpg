/**
 * 端口单一来源守卫：端口数字只允许出现在 packages/shared 与文档/示例中。
 * 其它位置一律从 @ai-trpg/shared 引用，避免文档、脚本、运行时各说各话。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sharedFile = "packages/shared/src/index.ts";

const sharedSource = readFileSync(path.join(root, sharedFile), "utf8");
const ports = [...sharedSource.matchAll(/DEFAULT_(?:SERVER|WEB)_PORT\s*=\s*(\d+)/g)].map(
  (match) => match[1],
);

if (ports.length !== 2 || new Set(ports).size !== 2) {
  console.error(`❌ 无法从 ${sharedFile} 读到两个不同的默认端口`);
  process.exit(1);
}

const allowed = [sharedFile, "scripts/check-ports.mjs", ".env.example", "README.md", "docs/"];

const ignoredDirs = new Set(["node_modules", "dist", ".git", "coverage", ".vite", ".idea"]);
const ignoredFiles = new Set([
  "pnpm-lock.yaml",
  "packages/api-client/openapi.json",
  "packages/api-client/src/schema.d.ts",
]);
const scannedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".md",
  ".yaml",
  ".yml",
]);

function isAllowed(relativePath) {
  return allowed.some((entry) =>
    entry.endsWith("/") ? relativePath.startsWith(entry) : relativePath === entry,
  );
}

const violations = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const absolutePath = path.join(directory, name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

    if (statSync(absolutePath).isDirectory()) {
      if (!ignoredDirs.has(name)) {
        walk(absolutePath);
      }
      continue;
    }

    if (ignoredFiles.has(relativePath) || isAllowed(relativePath)) {
      continue;
    }
    if (!scannedExtensions.has(path.extname(relativePath))) {
      continue;
    }

    const lines = readFileSync(absolutePath, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const port of ports) {
        if (new RegExp(`\\b${port}\\b`).test(line)) {
          violations.push(`${relativePath}:${index + 1}  硬编码端口 ${port}`);
        }
      }
    });
  }
}

walk(root);

if (violations.length > 0) {
  console.error("❌ 发现硬编码端口，请改为从 @ai-trpg/shared 引用：");
  for (const violation of violations) {
    console.error(`   ${violation}`);
  }
  process.exit(1);
}

console.log(`✅ 端口唯一来源检查通过（${ports.join(" / ")}）`);
