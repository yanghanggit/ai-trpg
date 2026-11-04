/**
 * `agent-game` 的命令装配与进程入口。
 *
 * 分层：`commands/*` 只声明「参数 → 服务层调用 → 输出」；上下文（数据库、日志）、
 * 错误语义与 stdout 契约在 `context.ts` / `errors.ts` / `io.ts`；入口只算退出码。
 */

import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { registerGameCommands } from "./commands/game";
import { registerInspectCommands } from "./commands/inspect";
import { registerPlayerCommands } from "./commands/player";
import { registerTraceCommands } from "./commands/trace";
import { registerTurnCommands } from "./commands/turn";
import { createContext } from "./context";
import { CliFailure } from "./errors";
import { emit } from "./io";

/** commander 用这几个 code 表示「帮助/版本已输出」，属于成功路径。 */
const DISPLAY_CODES = new Set(["commander.help", "commander.helpDisplayed", "commander.version"]);

function version(): string {
  const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}

export function createProgram(): Command {
  const program = new Command("agent-game")
    .description(
      "开发期 agent CLI：直连 PostgreSQL，按实体显式推进；stdout 只出 JSON，日志走 stderr",
    )
    .version(version(), "-v, --version", "打印版本")
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride();

  const ctx = createContext();
  registerGameCommands(program, ctx);
  registerPlayerCommands(program, ctx);
  registerTurnCommands(program, ctx);
  registerInspectCommands(program, ctx);
  registerTraceCommands(program, ctx);
  return program;
}

/** 命令失败时命令行里已经给出的子命令名，用于错误归属。 */
function actionFromArgv(argv: readonly string[]): string {
  return argv.find((token) => !token.startsWith("-")) ?? "agent-game";
}

/**
 * CLI 主入口：返回退出码而不是直接 `process.exit`，便于测试驱动与复用。
 *
 * 0 = 成功 / 帮助 / 版本；2 = 用法错误（commander 与 zod 已写好文案）；1 = 运行失败。
 */
export async function runAgentGameCli(argv: string[]): Promise<number> {
  const program = createProgram();
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && DISPLAY_CODES.has(error.code)) {
      return 0;
    }
    if (error instanceof CliFailure) {
      emit({ ok: false, action: error.action, error: error.message });
      return error.exitCode;
    }
    if (error instanceof CommanderError) {
      // commander 已把用法错误写到 stderr；stdout 仍给一份机器可读结果。
      emit({ ok: false, action: actionFromArgv(argv), error: error.message });
      return 2;
    }
    emit({
      ok: false,
      action: actionFromArgv(argv),
      error: error instanceof Error ? error.message : String(error),
    });
    return 1;
  }
}
