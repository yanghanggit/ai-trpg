/**
 * 运行时 system prompt 导出：调试旁路，不属于请求主路径。
 *
 * 让设计者直接看到 actor / stage 实际拿到的完整 prompt，不必翻数据库或日志。
 * 测试环境默认跳过，设置 `PROMPTS_DIR` 才强制导出。
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "./paths";

/** 覆盖导出根目录；也用于在测试环境强制开启导出。 */
export const PROMPTS_DIR_ENV = "PROMPTS_DIR";

const SAFE_FILENAME_PATTERN = /[^0-9A-Za-z_.\-\u4e00-\u9fff]/g;

export type PromptDumpInput = {
  world: {
    name: string;
    contentVersion: string;
    campaignSetting: string;
    systemRules: string;
  };
  actorPrompts: readonly { name: string; prompt: string }[];
  stagePrompts: readonly { name: string; prompt: string }[];
  /** world 作为全局 agent 的 system prompt；旧调用可省略。 */
  worldAgentPrompt?: string;
};

/** 导出根目录：`PROMPTS_DIR` > `<repo>/prompts`。 */
export function promptsRoot(root?: string): string {
  if (root !== undefined) {
    return join(root);
  }
  const overridden = process.env[PROMPTS_DIR_ENV]?.trim();
  if (overridden) {
    return join(overridden);
  }
  return join(findRepoRoot(), "prompts");
}

export function safeFileName(value: string): string {
  const safe = value.replace(SAFE_FILENAME_PATTERN, "_").replace(/^\.+/, "_").trim();
  return safe.length > 0 ? safe : "unnamed";
}

export function timestampName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 世界级说明：actor / stage prompt 共用的“游戏设定 + 全局规则”原文。 */
export function worldPromptMarkdown(input: PromptDumpInput["world"]): string {
  return `# ${input.name}

内容版本: ${input.contentVersion}

## 游戏设定

${input.campaignSetting}

## 全局规则

${input.systemRules}
`;
}

function shouldDump(): boolean {
  if (process.env[PROMPTS_DIR_ENV]?.trim()) {
    return true;
  }
  return !process.env.VITEST && process.env.NODE_ENV !== "test";
}

function uniqueContainer(root: string, base: string): string {
  let candidate = base;
  let index = 2;
  while (existsSync(join(root, candidate))) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  return candidate;
}

/** 写入失败只告警，不影响建局主流程。 */
export async function dumpSystemPrompts(
  input: PromptDumpInput,
  options: { root?: string; now?: Date } = {},
): Promise<string | null> {
  if (!shouldDump()) {
    return null;
  }

  try {
    const root = promptsRoot(options.root);
    const container = uniqueContainer(
      root,
      `${timestampName(options.now)}_${safeFileName(input.world.name)}`,
    );
    const dir = join(root, container);
    await mkdir(join(dir, "actors"), { recursive: true });
    await mkdir(join(dir, "stages"), { recursive: true });

    await writeFile(join(dir, "world.md"), worldPromptMarkdown(input.world), "utf8");
    if (input.worldAgentPrompt) {
      await writeFile(
        join(dir, "world-agent.md"),
        `${input.worldAgentPrompt}
`,
        "utf8",
      );
    }
    for (const stage of input.stagePrompts) {
      await writeFile(
        join(dir, "stages", `${safeFileName(stage.name)}.md`),
        `${stage.prompt}\n`,
        "utf8",
      );
    }
    for (const actor of input.actorPrompts) {
      await writeFile(
        join(dir, "actors", `${safeFileName(actor.name)}.md`),
        `${actor.prompt}\n`,
        "utf8",
      );
    }
    return dir;
  } catch (error) {
    console.warn(`[prompt-dump] 导出 system prompt 失败: ${String(error)}`);
    return null;
  }
}
