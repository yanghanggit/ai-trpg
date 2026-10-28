/**
 * 服务端通用最小日志接口（L2 进程日志，不是过程轨迹）。
 *
 * 业务叙事、prompt、工具调用走轨迹（`debug/trace.ts`）；这里只留启动、失败与降级告警。
 * 不直接依赖 Fastify / pino：库与测试默认静默，服务进程用 pino 适配器，CLI 用 consoleLogger。
 */

export type Logger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

function noop(): void {
  // 测试 / 库默认静默。
}

export const silentLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export const consoleLogger: Logger = {
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

export function loggerFromPino(log: PinoLikeLogger): Logger {
  const emit = (level: keyof PinoLikeLogger, message: string, args: readonly unknown[]): void => {
    const error = args.find((arg) => arg instanceof Error);
    if (error) {
      log[level]({ err: error }, message);
      return;
    }
    if (args.length > 0) {
      log[level](message, ...args.map(formatArg));
      return;
    }
    log[level](message);
  };
  return {
    debug: (message, ...args) => emit("debug", message, args),
    info: (message, ...args) => emit("info", message, args),
    warn: (message, ...args) => emit("warn", message, args),
    error: (message, ...args) => emit("error", message, args),
  };
}

function formatArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
