/**
 * 分层依赖守卫：传输 → 编排 → 服务，方向不能反过来。
 *
 * 判据是 import 图，不是目录位置：一次操作该对哪些实体、按什么顺序、注入哪组依赖，
 * 只允许出现在 `game-ops`；传输层自己拼流程就会长出第二套玩法。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function listTsFiles(dir: string): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return listTsFiles(relative);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [relative] : [];
  });
}

/** 模块里所有 `from "…"` 与 `import("…")` 的目标。 */
function importsOf(relativePath: string): string[] {
  const source = readFileSync(join(SRC, relativePath), "utf8");
  return [...source.matchAll(/(?:from|import\()\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
}

/** 把相对 import 解析成 `src/` 内的路径；包依赖返回 undefined。 */
function resolveImport(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const parts = importer.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") {
      continue;
    }
    if (segment === "..") {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

function pointsInto(resolved: string, prefix: string): boolean {
  return resolved === prefix || resolved.startsWith(`${prefix}/`);
}

function forbiddenImports(dir: string, forbidden: readonly string[]): string[] {
  return listTsFiles(dir).flatMap((relative) =>
    importsOf(relative).flatMap((specifier) => {
      const resolved = resolveImport(relative, specifier);
      if (resolved === undefined) {
        return [];
      }
      return forbidden.some((prefix) => pointsInto(resolved, prefix))
        ? [`${relative} → ${specifier}`]
        : [];
    }),
  );
}

/** 包级禁令：服务层不得碰传输框架。 */
function forbiddenPackages(dir: string, packages: readonly string[]): string[] {
  return listTsFiles(dir).flatMap((relative) =>
    importsOf(relative)
      .filter((specifier) => packages.includes(specifier))
      .map((specifier) => `${relative} → ${specifier}`),
  );
}

describe("分层依赖", () => {
  it("服务层不 import 传输层或编排层", () => {
    expect(forbiddenImports("game", ["routes", "cli", "game-ops", "plugins"])).toEqual([]);
    expect(forbiddenPackages("game", ["fastify", "fastify-type-provider-zod"])).toEqual([]);
  });

  it("编排层不 import 传输层", () => {
    expect(forbiddenImports("game-ops", ["routes", "cli", "plugins"])).toEqual([]);
  });

  it("HTTP 路由不 import 命令行", () => {
    expect(forbiddenImports("routes", ["cli"])).toEqual([]);
  });

  it("agent:api 不进进程内编排层，只走 HTTP 契约", () => {
    expect(forbiddenImports("cli/agent-api", ["game-ops", "routes"])).toEqual([]);
  });

  it("agent:game 不依赖 HTTP 客户端", () => {
    expect(forbiddenImports("cli/agent-game", ["cli/agent-api", "routes"])).toEqual([]);
  });
});
