/**
 * LLM 层最小日志接口（L2 进程日志，不是过程轨迹）。
 *
 * 业务叙事、prompt、工具调用走轨迹（`debug/trace.ts`）；这里只留启动、失败与降级告警。
 * 不直接依赖 Fastify / pino：编排层测试用 silentLogger，服务进程用 `loggerFromPino(app.log)`，
 * smoke 脚本用 consoleLogger。
 */

export type LlmLogger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

function noop(): void {
  // 测试 / 库默认静默。
}

export const silentLogger: LlmLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

/** pino 兼容的最小接口：只要四个级别方法，避免把 pino 类型带进 llm 层。 */
export type PinoLikeLogger = {
  debug: (objOrMessage: unknown, message?: string) => void;
  info: (objOrMessage: unknown, message?: string) => void;
  warn: (objOrMessage: unknown, message?: string) => void;
  error: (objOrMessage: unknown, message?: string) => void;
};

/**
 * 把 pino（或 Fastify 的 `app.log`）适配成本接口。
 *
 * `LlmLogger` 是 msg-first 且可带 Error：Error 进 `err` 字段，其余参数交给 pino 的
 * 格式化顺序，避免日志里只剩一个 `[object Object]`。
 */
export function loggerFromPino(log: PinoLikeLogger): LlmLogger {
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

/** CLI / smoke 专用：服务进程不要用它，用 `loggerFromPino(app.log)`。 */
export const consoleLogger: LlmLogger = {
  debug: (message, ...args) => {
    if (process.env.LOG_LEVEL === "debug" || process.env.LOG_LEVEL === "trace") {
      console.debug(message, ...args);
    }
  },
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};
