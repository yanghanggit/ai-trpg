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

const app = await buildApp({ env, logger: false });
await app.ready();
const openapi = app.swagger();
await app.close();

const outputPath = fileURLToPath(
  new URL("../../../packages/api-client/openapi.json", import.meta.url),
);
await writeFile(outputPath, `${JSON.stringify(openapi, null, 2)}\n`, "utf8");

console.log(`✅ 已生成 ${outputPath}`);
