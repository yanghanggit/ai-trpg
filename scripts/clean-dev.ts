/**
 * 清理开发期临时产物：prompts / worlds / stories / logs / screenshots / images。
 *
 * 这些目录只存调试输出（system prompt 导出、世界快照、故事总结、LLM 留痕、截图、生成图片），
 * 都被 gitignore 忽略，随时可以重新生成。脚本默认只预览，加 --yes 才真的删；
 * 目录本身与 .gitkeep 占位保留。
 *
 *   pnpm clean:dev                       # 预览将删除的内容
 *   pnpm clean:dev --yes                 # 真的删
 *   pnpm clean:dev --only prompts,logs   # 只清指定目录
 *   pnpm clean:dev --list                # 只列出可清目录
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

type Target = {
  name: string;
  /** 相对仓库根目录。 */
  path: string;
  description: string;
};

/** 会被清空的开发期目录；都在 .gitignore 里，删掉不损失源码。 */
const TARGETS: readonly Target[] = [
  { name: "prompts", path: "prompts", description: "运行时 system prompt 导出" },
  { name: "worlds", path: "worlds", description: "世界快照（snapshot 导出）" },
  { name: "stories", path: "stories", description: "故事总结导出" },
  { name: "logs", path: "logs", description: "LLM 对话留痕" },
  {
    name: "server-logs",
    path: "apps/server/logs",
    description: "从 apps/server 启动时写的 LLM 留痕",
  },
  { name: "screenshots", path: "screenshots", description: "Playwright 截图" },
  { name: "images", path: "images", description: "生成的图片资产" },
  {
    name: "cache",
    path: "apps/server/.cache",
    description: "Transformers.js 模型缓存（会重新下载）",
  },
];

type ParsedArgs = {
  names: string[];
  yes: boolean;
  list: boolean;
};

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { names: [], yes: false, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes" || arg === "-y") {
      parsed.yes = true;
      continue;
    }
    if (arg === "--list") {
      parsed.list = true;
      continue;
    }
    if (arg === "--only") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--only 需要目录名，例如 --only prompts,logs");
      }
      parsed.names.push(...value.split(",").map((name) => name.trim()));
      index += 1;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }
  return parsed;
}

/** 仓库根目录：往上找到 pnpm-workspace.yaml。 */
function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return resolve(start);
    }
    current = parent;
  }
}

async function sizeOf(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) {
    return info.size;
  }
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    total += await sizeOf(join(path, entry.name));
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

type Report = {
  name: string;
  path: string;
  exists: boolean;
  entries: string[];
  bytes: number;
  removed: boolean;
};

async function cleanTarget(root: string, target: Target, yes: boolean): Promise<Report> {
  const absolute = join(root, target.path);
  const report: Report = {
    name: target.name,
    path: target.path,
    exists: existsSync(absolute),
    entries: [],
    bytes: 0,
    removed: false,
  };
  if (!report.exists) {
    return report;
  }
  const entries = (await readdir(absolute, { withFileTypes: true })).filter(
    (entry) => entry.name !== ".gitkeep",
  );
  report.entries = entries.map((entry) => entry.name).sort();
  for (const entry of entries) {
    report.bytes += await sizeOf(join(absolute, entry.name));
  }
  if (!yes) {
    return report;
  }
  await mkdir(absolute, { recursive: true });
  for (const entry of entries) {
    // 保留占位文件，git 里这些目录仍然存在。
    if (entry.name === ".gitkeep") {
      continue;
    }
    await rm(join(absolute, entry.name), { recursive: true, force: true });
  }
  report.removed = true;
  return report;
}

function selectTargets(names: readonly string[]): Target[] {
  if (names.length === 0) {
    return [...TARGETS];
  }
  return names.map((name) => {
    const target = TARGETS.find((candidate) => candidate.name === name);
    if (!target) {
      throw new Error(
        `未知目录: ${name}（可用: ${TARGETS.map((candidate) => candidate.name).join(", ")}）`,
      );
    }
    return target;
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = findRepoRoot();
  const targets = selectTargets(args.names);

  if (args.list) {
    console.log("可清理的开发期目录：");
    for (const target of TARGETS) {
      console.log(`  ${target.name.padEnd(13)} ${target.path.padEnd(22)} ${target.description}`);
    }
    return;
  }

  const reports: Report[] = [];
  for (const target of targets) {
    reports.push(await cleanTarget(root, target, args.yes));
  }

  const active = reports.filter((report) => report.exists && report.entries.length > 0);
  const totalBytes = active.reduce((sum, report) => sum + report.bytes, 0);

  if (active.length === 0) {
    console.log("没有需要清理的内容。");
    return;
  }

  for (const report of active) {
    const verb = report.removed ? "已清空" : "可清理";
    console.log(
      `${verb} ${relative(root, join(root, report.path))}（保留 .gitkeep）: ` +
        `${report.entries.length} 项，${formatBytes(report.bytes)}`,
    );
    for (const entry of report.entries.slice(0, 5)) {
      console.log(`    - ${entry}`);
    }
    if (report.entries.length > 5) {
      console.log(`    … 另有 ${report.entries.length - 5} 项`);
    }
  }

  console.log("");
  if (args.yes) {
    console.log(`共清空 ${active.length} 个目录，释放 ${formatBytes(totalBytes)}。`);
  } else {
    console.log(`共 ${active.length} 个目录、${formatBytes(totalBytes)}。加 --yes 才会真的删除。`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
