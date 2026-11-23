import { config as loadEnvFile } from "dotenv";
import { buildApp } from "./app";
import { openDatabase } from "./db/connect";
import { loadEnv, ROOT_ENV_FILE } from "./env";

loadEnvFile({ path: ROOT_ENV_FILE, quiet: true });

const env = loadEnv();
// 连接池跟着进程走：路由只拿访问器，测试与 OpenAPI 导出不必建连接。
const { db, pool } = openDatabase();
const app = await buildApp({ env, db: () => db });

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "收到退出信号，正在关闭服务");
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
