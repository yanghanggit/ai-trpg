/**
 * `agent-api` 的命令装配与进程入口。
 *
 * 与 `agent:game` 刻意同构：同名子命令、同参数、同输出信封，只是把
 * 「直连 PostgreSQL」换成「请求运行中的服务端」。两条工作流因此可以逐命令对照。
 *
 * 一次性进程：stdout 只出 JSON（帮助 / 版本与 `--text` 模式除外），日志走 stderr。
 * 退出码：0 成功，1 运行或 HTTP 失败，2 用法错误。
 */

import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { CliFailure } from "../errors";
import { emit } from "../io";
import { registerActionOrderCommands } from "./commands/action-order";
import { registerGameCommands } from "./commands/game";
import { registerInspectCommands } from "./commands/inspect";
import { registerJobCommands } from "./commands/jobs";
import { registerPlayerCommands } from "./commands/player";
import { registerTickCommand } from "./commands/tick";
import { registerTraceCommands } from "./commands/trace";
import { registerTurnCommands } from "./commands/turn";

const DISPLAY_CODES = new Set(["commander.help", "commander.helpDisplayed", "commander.version"]);

function version(): string {
  const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version ?? "0.0.0";
}

export function createProgram(): Command {
  const program = new Command("agent-api")
    .description("开发期 HTTP CLI：逐次请求业务服务端，命令与 agent-game 对齐；stdout 只出 JSON")
    .version(version(), "-v, --version", "打印版本")
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride()
    .option("--base <url>", "服务端地址，默认 AGENT_API_BASE_URL 或本机默认端口")
    .option("--token <username>", "开发期身份：用户名，默认 AGENT_API_TOKEN")
    .option("--timeout <ms>", "单次请求超时，默认 120000");

  registerGameCommands(program);
  registerPlayerCommands(program);
  registerTurnCommands(program);
  registerActionOrderCommands(program);
  registerJobCommands(program);
  registerTickCommand(program);
  registerInspectCommands(program);
  registerTraceCommands(program);
  return program;
}

/** 命令失败时命令行里已经给出的子命令名，用于错误归属。 */
function actionFromArgv(argv: readonly string[]): string {
  return argv.find((token) => !token.startsWith("-")) ?? "agent-api";
}

export async function runAgentApiCli(argv: string[]): Promise<number> {
  const program = createProgram();
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && DISPLAY_CODES.has(error.code)) {
      return 0;
    }
    if (error instanceof CliFailure) {
      emit({ ok: false, action: error.action, error: error.message, ...error.details });
      return error.exitCode;
    }
    if (error instanceof CommanderError) {
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
