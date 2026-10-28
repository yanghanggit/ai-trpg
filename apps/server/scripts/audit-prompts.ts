/**
 * 框架层提示词与工具描述的语义审查（开发期工具，会真实调用 LLM）。
 *
 * 用法：
 *   pnpm --filter @ai-trpg/server audit:prompts                 # 审查 framework 目录
 *   pnpm --filter @ai-trpg/server audit:prompts --since origin/main
 *   pnpm --filter @ai-trpg/server audit:prompts --dry-run       # 只列出片段，不调用模型
 *   pnpm --filter @ai-trpg/server audit:prompts --json
 *
 * 退出码：0 干净；1 有 high（或 --strict 下任意）发现；2 配置/调用失败。
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { config as loadEnvFile } from "dotenv";
import { DEEPSEEK_MODEL_FLASH, DEEPSEEK_SERVICE } from "../src/deepseek";
import {
  type AuditFinding,
  auditCacheKey,
  buildAuditRequest,
  collectPromptSnippets,
  DEFAULT_AUDIT_BATCH_SIZE,
  type PromptSnippet,
  parseAuditResponse,
  type RawFinding,
  readAuditCache,
  writeAuditCache,
} from "../src/dev/prompt-audit";
import { ROOT_ENV_FILE } from "../src/env";

const SERVER_ROOT = join(import.meta.dirname, "..");
const REPO_ROOT = join(SERVER_ROOT, "../..");

type Options = {
  since?: string;
  dir: string;
  model: string;
  batchSize: number;
  json: boolean;
  dryRun: boolean;
  strict: boolean;
  noCache: boolean;
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function parseOptions(): Options {
  const batch = Number(option("--batch") ?? DEFAULT_AUDIT_BATCH_SIZE);
  return {
    since: option("--since"),
    dir: option("--dir") ?? join(SERVER_ROOT, "src/game"),
    model: option("--model") ?? DEEPSEEK_MODEL_FLASH,
    batchSize: Number.isInteger(batch) && batch > 0 ? batch : DEFAULT_AUDIT_BATCH_SIZE,
    json: process.argv.includes("--json"),
    dryRun: process.argv.includes("--dry-run"),
    strict: process.argv.includes("--strict"),
    noCache: process.argv.includes("--no-cache"),
  };
}

function printHelp(): void {
  console.log(`用法：audit-prompts [选项]

  --dir <path>     要审查的源码目录（默认 src/game）
  --since <ref>    只审查相对该 git 引用改动过的文件
  --model <name>   审查模型（默认 ${DEEPSEEK_MODEL_FLASH}）
  --batch <n>      每次请求包含的片段数（默认 ${DEFAULT_AUDIT_BATCH_SIZE}）
  --json           以 JSON 输出
  --dry-run        只列出将被审查的片段
  --strict         low 发现也让退出码为 1
  --no-cache       忽略本地结论缓存
  -h, --help       显示本帮助

退出码：0 干净；1 有发现；2 配置或调用失败。`);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function changedFiles(since: string): Set<string> {
  const paths = ["apps/server/src", "apps/server/scripts"];
  const run = (args: string[]): string =>
    execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" });
  const tracked = run(["diff", "--name-only", since, "--", ...paths]);
  const untracked = run(["ls-files", "--others", "--exclude-standard", "--", ...paths]);
  return new Set(
    `${tracked}\n${untracked}`
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => join(REPO_ROOT, line)),
  );
}

function flatten(
  snippets: readonly PromptSnippet[],
  verdicts: ReadonlyMap<PromptSnippet, readonly RawFinding[]>,
): AuditFinding[] {
  return snippets.flatMap((snippet) =>
    (verdicts.get(snippet) ?? []).map((finding) => ({ ...snippet, ...finding })),
  );
}

async function main(): Promise<void> {
  const options = parseOptions();
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const all = collectPromptSnippets({ dir: options.dir, repoRoot: REPO_ROOT });
  const changed = options.since === undefined ? undefined : changedFiles(options.since);
  const snippets =
    changed === undefined
      ? all
      : all.filter((snippet) => changed.has(join(REPO_ROOT, snippet.file)));

  if (snippets.length === 0) {
    console.log("没有需要审查的片段");
    return;
  }

  if (options.dryRun) {
    console.log(`将审查 ${snippets.length} 个片段（--dry-run，不调用模型）：`);
    for (const snippet of snippets) {
      console.log(`${snippet.file}:${snippet.line}  ${snippet.text.slice(0, 100)}`);
    }
    return;
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("缺少 DEEPSEEK_API_KEY：语义审查需要真实调用模型，或用 --dry-run 只看片段。");
    process.exitCode = 2;
    return;
  }

  const cacheDir = join(SERVER_ROOT, ".cache/prompt-audit");
  const verdicts = new Map<PromptSnippet, readonly RawFinding[]>();
  const pending: PromptSnippet[] = [];
  for (const snippet of snippets) {
    const cached = options.noCache
      ? null
      : readAuditCache(cacheDir, auditCacheKey(snippet.text, options.model));
    if (cached === null) {
      pending.push(snippet);
    } else {
      verdicts.set(snippet, cached);
    }
  }

  for (const batch of chunk(pending, options.batchSize)) {
    const items = batch.map((snippet, index) => ({
      id: `s${index + 1}`,
      text: snippet.text,
    }));
    const result = await DEEPSEEK_SERVICE.complete(
      buildAuditRequest({ items, model: options.model }),
    );
    if (result.error !== undefined) {
      console.error(`审查请求失败：${result.error.kind} ${result.error.message}`);
      process.exitCode = 2;
      return;
    }
    const parsed = parseAuditResponse(result.content);
    batch.forEach((snippet, index) => {
      const findings = parsed.get(`s${index + 1}`) ?? [];
      verdicts.set(snippet, findings);
      if (!options.noCache) {
        writeAuditCache(cacheDir, auditCacheKey(snippet.text, options.model), findings);
      }
    });
  }

  const findings = flatten(snippets, verdicts);
  if (options.json) {
    console.log(JSON.stringify({ snippets: snippets.length, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log(
      `没有发现题材泄漏：审查 ${snippets.length} 个片段（缓存 ${snippets.length - pending.length}）`,
    );
  } else {
    console.log(`发现 ${findings.length} 处可疑文本：审查 ${snippets.length} 个片段`);
    for (const finding of findings) {
      console.log(`\n${finding.file}:${finding.line}  [${finding.category}/${finding.severity}]`);
      console.log(`  ${finding.quote}`);
      if (finding.reason.length > 0) {
        console.log(`  理由：${finding.reason}`);
      }
      if (finding.suggestion.length > 0) {
        console.log(`  建议：${finding.suggestion}`);
      }
    }
  }

  const failed = options.strict
    ? findings.length > 0
    : findings.some((finding) => finding.severity === "high");
  if (failed) {
    process.exitCode = 1;
  }
}

loadEnvFile({ path: ROOT_ENV_FILE, quiet: true });
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
