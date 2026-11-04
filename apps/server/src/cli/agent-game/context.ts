/**
 * 命令执行上下文：数据库连接池的打开/释放、进程日志。
 *
 * 每个命令是一次性进程，所以连接池按命令创建、跑完即关；logger 只在真正要写日志时才
 * 创建，纯读命令不付 pino transport（worker thread）的启动成本。
 */

import pino from "pino";
import { openDatabase } from "../../db/connect";
import type { Database } from "../../db/pool";
import { type Logger, loggerFromPino } from "../../logging";

export type CommandContext = {
  /** 打开一个连接池跑完 `fn` 后释放；跨命令不复用。 */
  db<T>(fn: (db: Database) => Promise<T>): Promise<T>;
  /** 进程日志（stderr），按需创建。 */
  log(): Logger;
};

let cachedLogger: Logger | undefined;

function cliLogger(): Logger {
  cachedLogger ??= loggerFromPino(
    pino({
      level: process.env.LOG_LEVEL ?? "info",
      transport: {
        target: "pino-pretty",
        options: { destination: 2, translateTime: "SYS:standard", ignore: "pid,hostname" },
      },
    }),
  );
  return cachedLogger;
}

export function createContext(): CommandContext {
  return {
    async db(fn) {
      const { db, pool } = openDatabase();
      try {
        return await fn(db);
      } finally {
        await pool.end();
      }
    },
    log: cliLogger,
  };
}
