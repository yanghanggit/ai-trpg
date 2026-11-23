/**
 * CLI 的 stdout 契约：默认只出 JSON 信封，`--text` 之类的人类模式单独走 `emitText`。
 *
 * 进程日志与 commander 的用法错误走 stderr；stdout 留给调用方（agent / jq）解析。
 */

export type Output = Record<string, unknown>;

export function emit(payload: Output): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/** 人类模式输出：不加 JSON 信封，调用方显式选择了非机器可读的形态。 */
export function emitText(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}
