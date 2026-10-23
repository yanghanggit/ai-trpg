/**
 * 开发期故事总结导出。
 *
 * story agent 本身只读；CLI 在拿到结果后把故事写到 `stories/`，
 * 便于设计者直接阅读与比较。目录内容被 gitignore。
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "./paths";
import { safeFileName, timestampName } from "./prompt-dump";

export const STORIES_DIR_ENV = "STORIES_DIR";

export type StoryDumpInput = {
  gameName: string;
  gameSlug: string;
  gameStatus: string;
  contentVersion: string;
  version: number;
  story: string;
  rounds?: number;
  memoriesRead?: readonly string[];
  eventsRead?: boolean;
  now?: Date;
};

/** 导出根目录：`STORIES_DIR` > `<repo>/stories`。 */
export function storiesRoot(root?: string): string {
  if (root !== undefined) {
    return join(root);
  }
  const overridden = process.env[STORIES_DIR_ENV]?.trim();
  if (overridden) {
    return join(overridden);
  }
  return join(findRepoRoot(), "stories");
}

function uniqueFile(root: string, base: string): string {
  let candidate = `${base}.md`;
  let index = 2;
  while (existsSync(join(root, candidate))) {
    candidate = `${base}_${index}.md`;
    index += 1;
  }
  return candidate;
}

function storyMarkdown(input: StoryDumpInput): string {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const memories = input.memoriesRead ?? [];
  return `# ${input.gameName} · 故事总结

- slug: ${input.gameSlug}
- 状态: ${input.gameStatus}
- 内容版本: ${input.contentVersion}
- 游戏版本: ${input.version}
- 生成时间: ${generatedAt}
- agent 轮数: ${input.rounds ?? "-"}
- 读取记忆: ${memories.length}
- 读取事件流: ${input.eventsRead === true ? "是" : "否"}

## 读取的记忆

${memories.length > 0 ? memories.map((item) => `- ${item}`).join("\n") : "- 无"}

---

${input.story.trim()}
`;
}

/** 写一份故事总结；返回文件路径。写入失败时抛错，由调用方决定是否降级。 */
export async function dumpStory(
  input: StoryDumpInput,
  options: { root?: string } = {},
): Promise<string> {
  const root = storiesRoot(options.root);
  await mkdir(root, { recursive: true });
  const now = input.now ?? new Date();
  const base = `${timestampName(now)}_${safeFileName(input.gameSlug)}`;
  const path = join(root, uniqueFile(root, base));
  await writeFile(path, storyMarkdown(input), "utf8");
  return path;
}
