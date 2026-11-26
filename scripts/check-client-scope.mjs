#!/usr/bin/env node
/**
 * 客户端范围守卫：玩家端只读观看者投影，不碰控制面。
 *
 * 判据是请求路径而不是 import：`/state`、`/memory`、`/traces` 这些端点是全知视图，
 * 它们的读者是管理后台与开发期 CLI。一旦 web 里出现这些路径，遮蔽与全知就会在同一个
 * 产物里并存——两个 app 的分界也就没有意义了。
 *
 * 这条规则说的是「谁能读什么」，与目下有几个 app 无关：后台被删掉它同样成立。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const webSrc = path.join(root, "apps/web/src");

/** 控制面端点：按字符串字面量的结尾判定，避免命中 `state` 这类普通变量名。 */
const FORBIDDEN = [
  "/state",
  "/memory",
  "/name-leaks",
  "/probe",
  "/traces",
  "/compact",
  "/snapshot",
  "/story",
  "/log",
];

const violations = [];

function listSourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) {
      return listSourceFiles(absolute);
    }
    return /\.(?:ts|tsx)$/.test(absolute) ? [absolute] : [];
  });
}

/** 取出源码里所有引号字符串的内容（单引号、双引号、反引号）。 */
function stringLiteralsOf(source) {
  return [...source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((match) => match[2]);
}

for (const file of listSourceFiles(webSrc)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  for (const literal of stringLiteralsOf(readFileSync(file, "utf8"))) {
    for (const endpoint of FORBIDDEN) {
      if (literal.endsWith(endpoint)) {
        violations.push(`${relative} 引用了控制面路径 ${endpoint}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("❌ 玩家端读到了控制面端点，请把它放进 apps/admin：");
  for (const violation of violations) {
    console.error(`   ${violation}`);
  }
  process.exit(1);
}

console.log("✅ 客户端范围检查通过（web 只读观看者投影）");
