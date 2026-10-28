/**
 * 图像生成层最小日志接口（L2 进程日志，不是资产生成记录）。
 *
 * 与 `llm/logger.ts` 保持同样的四个级别，但不把 LLM 类型带进图像层；
 * 服务进程可复用 pino 适配器，CLI 用 consoleLogger，测试用 silentLogger。
 */

export type ImageLogger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

function noop(): void {
  // 测试 / 库默认静默。
}

export const silentLogger: ImageLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export const consoleLogger: ImageLogger = {
  debug: (message, ...args) => {
    if (process.env.LOG_LEVEL === "debug" || process.env.LOG_LEVEL === "trace") {
      console.debug(message, ...args);
    }
  },
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};

/** pino / Fastify `app.log` 的最小适配接口。 */
export type PinoLikeLogger = {
  debug: (objOrMessage: unknown, message?: string) => void;
  info: (objOrMessage: unknown, message?: string) => void;
  warn: (objOrMessage: unknown, message?: string) => void;
  error: (objOrMessage: unknown, message?: string) => void;
};

export function loggerFromPino(log: PinoLikeLogger): ImageLogger {
  return {
    debug: (message) => log.debug(message),
    info: (message) => log.info(message),
    warn: (message) => log.warn(message),
    error: (message, ...args) => {
      const error = args.find((arg) => arg instanceof Error);
      if (error) {
        log.error({ err: error }, message);
        return;
      }
      log.error(message);
    },
  };
}
