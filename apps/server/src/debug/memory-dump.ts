/**
 * 记忆快照导出：把某个 agent 当前的 memory 渲染成一份 Markdown。
 *
 * - 只读数据库里的 memory 投影，不含当前舞台、observation、工具定义与本轮任务提示词。
 * - 默认写到 `<repo>/logs/memories/<gameSlug>/`，`MEMORIES_DIR` 可覆盖根目录。
 * - 自动文件名：`<YYYYMMDD_HHmmss>-v<游戏版本>-<ownerType>-<ownerName>.md`；同一秒重复导出追加序号。
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AgentMemoryMessageState, AgentMemoryState } from "../game/memory";
import { findRepoRoot } from "./paths";
import { safeFileName, timestampName } from "./prompt-dump";
import { markdownFence } from "./trace";

export const MEMORIES_DIR_ENV = "MEMORIES_DIR";

export type MemoryDumpGame = {
  id: string;
  name: string;
  slug: string;
  status: string;
  version: number;
  contentVersion: string;
};

export type MemoryDumpInput = {
  game: MemoryDumpGame;
  memory: AgentMemoryState;
  now?: Date;
};

export type MemoryDumpOptions = {
  /** 覆盖根目录；不给时用 `MEMORIES_DIR` 或仓库根 `logs/memories/`。 */
  root?: string;
  /** 目录或明确的 `.md` 路径；目录时自动命名并避免覆盖。 */
  out?: string;
  now?: Date;
};

/** 导出根目录：显式 root > `MEMORIES_DIR` > `<repo>/logs/memories`。 */
export function memoriesRoot(root?: string): string {
  if (root !== undefined) {
    return join(root);
  }
  const overridden = process.env[MEMORIES_DIR_ENV]?.trim();
  if (overridden) {
    return join(overridden);
  }
  return join(findRepoRoot(), "logs", "memories");
}

export function memoryDumpFileName(
  game: Pick<MemoryDumpGame, "version">,
  memory: Pick<AgentMemoryState, "ownerType" | "name">,
  now: Date,
): string {
  return `${timestampName(now)}-v${game.version}-${safeFileName(memory.ownerType)}-${safeFileName(memory.name)}.md`;
}

const OWNER_LABELS: Record<string, string> = {
  actor: "角色",
  stage: "舞台",
  world: "世界",
};

function ownerLabel(ownerType: string): string {
  return OWNER_LABELS[ownerType] ?? ownerType;
}

function kindOf(metadata: unknown): string {
  if (typeof metadata !== "object" || metadata === null) {
    return "-";
  }
  const kind = (metadata as { kind?: unknown }).kind;
  return typeof kind === "string" && kind.length > 0 ? kind : "-";
}

function visibilityOf(metadata: unknown): string {
  if (typeof metadata !== "object" || metadata === null) {
    return "-";
  }
  const visibility = (metadata as { visibility?: unknown }).visibility;
  return typeof visibility === "string" && visibility.length > 0 ? visibility : "-";
}

/** 索引摘要：首个非空行，截断并转义表格竖线。 */
function firstLine(content: string): string {
  const line = content.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  const trimmed = line.trim();
  const clipped = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  return clipped.replace(/\|/g, "\\|");
}

function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return "-";
  }
  return `${Math.round(ratio * 100)}%`;
}

/** 类别直方图，按首次出现排序。 */
function kindHistogram(messages: readonly AgentMemoryMessageState[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const kind = kindOf(message.metadata);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()];
}

/** 行内 JSON 会破坏 Markdown 时退回围栏。 */
function metadataBlock(metadata: unknown): string {
  const compact = JSON.stringify(metadata);
  if (compact === undefined) {
    return "";
  }
  if (compact.length <= 180 && !compact.includes("`") && !compact.includes("\n")) {
    return `- metadata: \`${compact}\`\n`;
  }
  return `- metadata:\n\n${markdownFence(JSON.stringify(metadata, null, 2), "json")}\n`;
}

function renderMessage(message: AgentMemoryMessageState): string {
  const toolCallId =
    message.toolCallId === undefined ? "" : `- tool_call_id: ${message.toolCallId}\n`;
  const toolCalls =
    message.toolCalls === undefined
      ? ""
      : `\ntool_calls:\n\n${markdownFence(JSON.stringify(message.toolCalls, null, 2), "json")}\n`;
  return `\n\n### #${message.sequence} · ${message.type} · ${kindOf(message.metadata)}

- 时间: ${message.createdAt}
- 字符数: ${message.content.length}
${toolCallId}${metadataBlock(message.metadata)}
${markdownFence(message.content)}${toolCalls}`;
}

export function renderMemoryMarkdown(input: MemoryDumpInput): string {
  const { game, memory } = input;
  const now = input.now ?? new Date();
  const chars = memory.messages.reduce((sum, message) => sum + message.content.length, 0);
  const histogram = kindHistogram(memory.messages);

  let markdown = `# 记忆快照 · ${memory.name}

> 数据库 memory 的原样投影，不含当前舞台、observation、工具定义与本轮任务提示词。
> 运行时（行动与探针）拿到的就是这些消息，顺序即 sequence。
> 回读顺序：先看「索引」定位，再按序读「正文」；标题里的 \`#N\` 就是 memory 序号。

## 目标

- 局: ${game.name}
- slug: ${game.slug}
- 游戏 id: ${game.id}
- 状态: ${game.status}
- 游戏版本: ${game.version}
- 内容版本: ${game.contentVersion}
- 导出时间: ${now.toISOString()}
- 所有者: ${memory.ownerType}（${ownerLabel(memory.ownerType)}）· ${memory.name}
- 所有者 id: ${memory.ownerId}
- 记忆 id: ${memory.id}
- 消息数: ${memory.messages.length}
- 字符数: ${chars}
- 上下文占用: ${formatRatio(memory.contextUsageRatio)}

## 记忆类别

`;

  markdown +=
    histogram.length === 0
      ? "- 无\n"
      : `${histogram.map(([kind, count]) => `- ${kind}: ${count}`).join("\n")}\n`;

  markdown += `
## 索引

| # | type | kind | visibility | 字符 | 首行 |
| ---: | --- | --- | --- | ---: | --- |
`;

  for (const message of memory.messages) {
    markdown += `| ${message.sequence} | ${message.type} | ${kindOf(message.metadata)} | ${visibilityOf(
      message.metadata,
    )} | ${message.content.length} | ${firstLine(message.content)} |\n`;
  }

  markdown += "\n## 正文";

  for (const message of memory.messages) {
    markdown += renderMessage(message);
  }

  return `${markdown}\n`;
}

function uniqueFile(dir: string, fileName: string): string {
  const base = fileName.replace(/\.md$/, "");
  let candidate = `${base}.md`;
  let index = 2;
  while (existsSync(join(dir, candidate))) {
    candidate = `${base}_${index}.md`;
    index += 1;
  }
  return candidate;
}

/** `out` 指向 `.md` 时按明确路径写入（允许覆盖）；否则当作目录并自动命名。 */
export async function dumpMemory(
  input: MemoryDumpInput,
  options: MemoryDumpOptions = {},
): Promise<string> {
  const now = options.now ?? input.now ?? new Date();
  const fileName = memoryDumpFileName(input.game, input.memory, now);
  const requested = options.out?.trim();
  const explicitFile = requested?.endsWith(".md") === true;
  const dir =
    requested === undefined || explicitFile
      ? join(memoriesRoot(options.root), safeFileName(input.game.slug))
      : resolve(requested);
  const path =
    requested !== undefined && explicitFile
      ? resolve(requested)
      : join(dir, uniqueFile(dir, fileName));

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderMemoryMarkdown({ ...input, now }), "utf8");
  return path;
}
