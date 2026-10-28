/**
 * 作业 worker 入口：加载显式作业注册表并消费持久队列。
 *
 *   pnpm job:worker           常驻 worker
 *   pnpm job:worker --once    领取并执行一轮后退出
 *
 * 不启动 HTTP 服务；未来服务端可以在同进程调用 `JobWorker.start()`。
 */

import { parseArgs } from "node:util";
import { openDatabase } from "../src/db/connect";
import { JobRegistry, JobStore, JobWorker } from "../src/jobs";
import { registerJobDefinitions } from "../src/jobs/definitions";
import { consoleLogger } from "../src/logging";

const cliOptions = {
  once: { type: "boolean" },
  queues: { type: "string", short: "q" },
  concurrency: { type: "string", short: "c" },
  "poll-interval": { type: "string" },
  "stale-after": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

function fail(message: string): never {
  throw new Error(message);
}

function integerValue(value: string | boolean | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    fail(`${name} 必须是正整数`);
  }
  return Number(value);
}

function usage(): void {
  console.log(
    [
      "作业 worker",
      "",
      "用法：",
      "  pnpm job:worker [options]",
      "",
      "选项：",
      "  -q, --queues <a,b>        监听队列，默认 default",
      "  -c, --concurrency <n>     并发数，默认 2",
      "      --poll-interval <ms>  空闲轮询间隔，默认 1000",
      "      --stale-after <s>     失联回收阈值，默认 900；0 关闭",
      "      --once                领取并执行一轮后退出",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: cliOptions,
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) {
    usage();
    return;
  }

  const queuesValue = parsed.values.queues;
  const queues =
    typeof queuesValue === "string"
      ? queuesValue
          .split(",")
          .map((queue) => queue.trim())
          .filter(Boolean)
      : ["default"];
  const concurrency = integerValue(parsed.values.concurrency, "--concurrency");
  const pollIntervalMs = integerValue(parsed.values["poll-interval"], "--poll-interval");
  const staleAfterSeconds = integerValue(parsed.values["stale-after"], "--stale-after");
  const once = parsed.values.once === true;

  const registry = new JobRegistry();
  registerJobDefinitions(registry);
  if (registry.size === 0) {
    consoleLogger.warn(
      "未注册业务作业；已入队但未注册的 kind 会被标记失败。请在 src/jobs/definitions.ts 注册。",
    );
  }

  const handle = openDatabase();
  const worker = new JobWorker({
    store: new JobStore(handle.db),
    registry,
    queues,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(staleAfterSeconds !== undefined ? { staleAfterMs: staleAfterSeconds * 1_000 } : {}),
    logger: consoleLogger,
  });

  if (once) {
    try {
      const claimed = await worker.runOnce();
      console.log(JSON.stringify({ ok: true, action: "job-worker", claimed }));
    } finally {
      await handle.pool.end();
    }
    return;
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    consoleLogger.info(`收到 ${signal}，停止作业 worker`);
    await worker.stop();
  };
  process.once("SIGINT", (signal) => void shutdown(signal));
  process.once("SIGTERM", (signal) => void shutdown(signal));

  try {
    await worker.start();
  } finally {
    await handle.pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
