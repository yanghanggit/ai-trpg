import { config as loadEnvFile } from "dotenv";
import { buildApp } from "./app";
import { openDatabase } from "./db/connect";
import { DEEPSEEK_SERVICE } from "./deepseek";
import { loadEnv, ROOT_ENV_FILE } from "./env";
import { createTurnJobRegistry, TURN_QUEUE } from "./game-ops";
import { JobStore, JobWorker } from "./jobs";
import type { Logger } from "./logging";

loadEnvFile({ path: ROOT_ENV_FILE, quiet: true });

const env = loadEnv();
// 连接池跟着进程走：路由只拿访问器，测试与 OpenAPI 导出不必建连接。
const { db, pool } = openDatabase();
const app = await buildApp({ env, db: () => db });

/**
 * 回合作业在本进程里跑：入队与执行同一个部署单元，`dev` 一条命令就能推进回合。
 *
 * 拆到独立进程（`pnpm job:worker`）是扩容选项，不是当前形态；无论哪种，串行键都在库里，
 * 同一局的回合不会并发。
 */
const worker = new JobWorker({
  store: new JobStore(db),
  registry: createTurnJobRegistry({
    db: () => db,
    services: () => ({ service: DEEPSEEK_SERVICE, inferenceService: DEEPSEEK_SERVICE }),
  }),
  queues: [TURN_QUEUE],
  logger: jobLogger(),
});

void worker.start().catch((error: unknown) => {
  app.log.error(error, "回合作业 worker 退出");
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "收到退出信号，正在关闭服务");
  // 先停领取，再关连接池：正在跑的回合要能把自己的心跳与结果写完。
  await worker.stop();
  await app.close();
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

/** 作业层只传「一句文本 + 可选错误」，pino 那边则是结构化对象在前。 */
function jobLogger(): Logger {
  const log = (level: "debug" | "info" | "warn" | "error", message: string, args: unknown[]) => {
    app.log[level](detailOf(args), message);
  };
  return {
    debug: (message, ...args) => log("debug", message, args),
    info: (message, ...args) => log("info", message, args),
    warn: (message, ...args) => log("warn", message, args),
    error: (message, ...args) => log("error", message, args),
  };
}

function detailOf(args: readonly unknown[]): Record<string, unknown> {
  const [first] = args;
  if (first === undefined) {
    return {};
  }
  return first instanceof Error ? { err: first } : { detail: first };
}
