/**
 * LLM 层最小日志接口。
 *
 * 不直接依赖 Fastify / pino：编排层可以在测试里用 silentLogger，服务端可以把
 * `app.log` 适配成这个接口，smoke 脚本则用 consoleLogger。
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
