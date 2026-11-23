/**
 * 离线导出 OpenAPI：直接构建 app 并调用 swagger()，不监听端口、不访问网络。
 * 产物：packages/api-client/openapi.json
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_PORT, DEFAULT_WEB_PORT, webBaseUrl } from "@ai-trpg/shared";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/env";

const env = loadEnv({
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: String(DEFAULT_SERVER_PORT),
  CORS_ORIGINS: webBaseUrl(DEFAULT_WEB_PORT),
  LOG_LEVEL: "silent",
});

/** 导出契约不需要数据库：访问器一旦被调用就说明有路由在装配阶段碰了连接池。 */
const app = await buildApp({
  env,
  logger: false,
  db: () => {
    throw new Error("OpenAPI 导出不连接数据库");
  },
});
await app.ready();
const openapi = app.swagger();
await app.close();

/**
 * 只留下从路径可达的 schema。
 *
 * 具名 schema 由库自动派生出 `XxxInput` / `Xxx` 两份（请求侧与响应侧），只用得到响应侧那份；
 * 契约里多出一个没人引用的同名类型，读契约的人就得猜它是不是也要用。
 * 可达性从 `paths` 出发按引用传递，所以被删掉的 schema 不会留着它的依赖。
 */
function pruneUnreachableSchemas(document: Record<string, unknown>): void {
  const components = document.components as { schemas?: Record<string, unknown> } | undefined;
  const schemas = components?.schemas;
  if (schemas === undefined) {
    return;
  }

  const refsIn = (value: unknown, into: Set<string>): void => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        refsIn(entry, into);
      });
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === "$ref" && typeof entry === "string") {
        into.add(entry);
      } else {
        refsIn(entry, into);
      }
    }
  };

  const fromPaths = new Set<string>();
  refsIn(document.paths, fromPaths);

  const reachable = new Set<string>();
  const queue = [...fromPaths];
  while (queue.length > 0) {
    const ref = queue.pop();
    const name = ref?.replace("#/components/schemas/", "");
    if (name === undefined || reachable.has(name) || !(name in schemas)) {
      continue;
    }
    reachable.add(name);
    const nested = new Set<string>();
    refsIn(schemas[name], nested);
    queue.push(...nested);
  }

  for (const name of Object.keys(schemas)) {
    if (!reachable.has(name)) {
      delete schemas[name];
    }
  }
}

pruneUnreachableSchemas(openapi as unknown as Record<string, unknown>);

const outputPath = fileURLToPath(
  new URL("../../../packages/api-client/openapi.json", import.meta.url),
);
await writeFile(outputPath, `${JSON.stringify(openapi, null, 2)}\n`, "utf8");

console.log(`✅ 已生成 ${outputPath}`);
