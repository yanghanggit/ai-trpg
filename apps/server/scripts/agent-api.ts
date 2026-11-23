/**
 * 开发期 HTTP CLI 的可执行入口；实现见 `src/cli/agent-api/`。
 *
 * 一次性进程：一次调用发一次请求，不缓存世界状态；stdout 只出 JSON，
 * 进程日志与用法错误走 stderr。退出码：0 成功，1 运行失败，2 用法错误。
 */

import { config as loadEnvFile } from "dotenv";
import { runAgentApiCli } from "../src/cli/agent-api";
import { ROOT_ENV_FILE } from "../src/env";

// 与其它开发脚本一致：仓库根 `.env` 提供 AGENT_API_* 与日志开关。
loadEnvFile({ path: ROOT_ENV_FILE, quiet: true });

process.exitCode = await runAgentApiCli(process.argv.slice(2));
