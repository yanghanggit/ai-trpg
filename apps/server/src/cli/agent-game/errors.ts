/**
 * CLI 失败模型：用法错误退出码 2，运行失败退出码 1，成功 0。
 *
 * 失败必须带 `action`（出错的子命令），否则 agent 侧只能看到一条没有出处的错误。
 */

import { ZodError } from "zod";

/** 参数组合错误：缺必需的组、互斥项同时出现、取值越界之外的结构问题。 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** 已经定好归属与退出码的失败，顶层只负责渲染。 */
export class CliFailure extends Error {
  constructor(
    message: string,
    readonly action: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "CliFailure";
  }
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export function describeFailure(error: unknown, action: string): CliFailure {
  if (error instanceof CliFailure) {
    return error;
  }
  if (error instanceof UsageError) {
    return new CliFailure(error.message, action, 2);
  }
  if (error instanceof ZodError) {
    return new CliFailure(formatZodError(error), action, 2);
  }
  return new CliFailure(error instanceof Error ? error.message : String(error), action, 1);
}
