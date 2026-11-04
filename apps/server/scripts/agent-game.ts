/**
 * 开发期 agent CLI 的可执行入口；实现见 `src/cli/agent-game/`。
 *
 * 一次性进程：stdout 只出 JSON（`--help` / `--version` 与 `--text` 模式除外），
 * 进程日志走 stderr。退出码：0 成功，1 运行失败，2 用法错误。
 */

import { runAgentGameCli } from "../src/cli/agent-game";

process.exitCode = await runAgentGameCli(process.argv.slice(2));
