/**
 * 运行时 system prompt 导出：调试旁路，不属于请求主路径。
 *
 * 让设计者直接看到 world / actor / stage 实际拿到的完整 prompt，不必翻数据库或日志。
 * 测试环境默认跳过，设置 `PROMPTS_DIR` 才强制导出。
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../logging";
import { findRepoRoot } from "./paths";

/** 覆盖导出根目录；也用于在测试环境强制开启导出。 */
export const PROMPTS_DIR_ENV = "PROMPTS_DIR";

const SAFE_FILENAME_PATTERN = /[^0-9A-Za-z_.\-\u4e00-\u9fff]/g;

export type PromptDumpInput = {
  /** 世界名做文件名（与 actor / stage 一致）；内容版本进容器目录名。 */
  world: { name: string; contentVersion: string };
  worldPrompt: string;
  /** 世界职能的宪法：每份独立、没有 memory；这里只带要写的文件名与正文。 */
  functionPromptDumps: readonly { name: string; prompt: string }[];
  actorPrompts: readonly { name: string; prompt: string }[];
  stagePrompts: readonly { name: string; prompt: string }[];
};

/** 导出根目录：`PROMPTS_DIR` > `<repo>/logs/prompts`。 */
export function promptsRoot(root?: string): string {
  if (root !== undefined) {
    return join(root);
  }
  const overridden = process.env[PROMPTS_DIR_ENV]?.trim();
  if (overridden) {
    return join(overridden);
  }
  return join(findRepoRoot(), "logs", "prompts");
}

export function safeFileName(value: string): string {
  const safe = value.replace(SAFE_FILENAME_PATTERN, "_").replace(/^\.+/, "_").trim();
  return safe.length > 0 ? safe : "unnamed";
}

export function timestampName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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
  options: { root?: string; now?: Date; logger?: Logger } = {},
): Promise<string | null> {
  if (!shouldDump()) {
    return null;
  }

  try {
    const root = promptsRoot(options.root);
    const container = uniqueContainer(
      root,
      `${timestampName(options.now)}_${safeFileName(input.world.name)}_${safeFileName(input.world.contentVersion)}`,
    );
    const dir = join(root, container);
    await mkdir(join(dir, "actors"), { recursive: true });
    await mkdir(join(dir, "stages"), { recursive: true });
    await mkdir(join(dir, "functions"), { recursive: true });

    await writeFile(
      join(dir, `${safeFileName(input.world.name)}.md`),
      `${input.worldPrompt}
`,
      "utf8",
    );
    for (const fn of input.functionPromptDumps) {
      await writeFile(
        join(dir, "functions", `${safeFileName(fn.name)}.md`),
        `${fn.prompt}\n`,
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
    options.logger?.warn("导出 system prompt 失败", error);
    return null;
  }
}
