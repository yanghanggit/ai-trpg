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

/** 容器里的元信息文件名：列举时先读它，读不到就当不是导出容器。 */
export const MANIFEST_FILE = "manifest.json";

const SAFE_FILENAME_PATTERN = /[^0-9A-Za-z_.\-\u4e00-\u9fff]/g;

export type PromptDumpInput = {
  /** 哪一局建的：写进 manifest，目录名里放不下（世界名与版本都可能是多局共用的）。 */
  game: { slug: string };
  /** 世界名做文件名（与 actor / stage 一致）；内容版本进容器目录名。 */
  world: { name: string; contentVersion: string };
  worldPrompt: string;
  /** 世界职能的宪法：每份独立、没有 memory；这里只带要写的文件名与正文。 */
  functionPromptDumps: readonly { name: string; prompt: string }[];
  actorPrompts: readonly { name: string; prompt: string }[];
  stagePrompts: readonly { name: string; prompt: string }[];
};

/** 容器里的文件清单：读的时候只按这份清单取，不拼任意路径。 */
export type PromptDumpFile = {
  kind: "world" | "function" | "stage" | "actor";
  /** 人类名（世界名 / 职能名 / 舞台名 / 角色名），不带扩展名。 */
  name: string;
  /** 容器内的相对路径，`/` 分隔。 */
  path: string;
  bytes: number;
};

/** `manifest.json`：谁建的、什么时候建的、里面有哪些文件。 */
export type PromptDumpManifest = {
  game: { slug: string };
  world: { name: string; contentVersion: string };
  createdAt: string;
  files: PromptDumpFile[];
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

    const files: PromptDumpFile[] = [];
    const write = async (
      kind: PromptDumpFile["kind"],
      name: string,
      path: string,
      body: string,
    ) => {
      await writeFile(join(dir, ...path.split("/")), body, "utf8");
      files.push({ kind, name, path, bytes: Buffer.byteLength(body, "utf8") });
    };

    await write(
      "world",
      input.world.name,
      `${safeFileName(input.world.name)}.md`,
      input.worldPrompt,
    );
    for (const fn of input.functionPromptDumps) {
      await write("function", fn.name, `functions/${safeFileName(fn.name)}.md`, fn.prompt);
    }
    for (const stage of input.stagePrompts) {
      await write("stage", stage.name, `stages/${safeFileName(stage.name)}.md`, stage.prompt);
    }
    for (const actor of input.actorPrompts) {
      await write("actor", actor.name, `actors/${safeFileName(actor.name)}.md`, actor.prompt);
    }

    // 目录名只有时间、世界名与版本，认不出是哪一局建的；manifest 补上这一层。
    const manifest: PromptDumpManifest = {
      game: { slug: input.game.slug },
      world: { name: input.world.name, contentVersion: input.world.contentVersion },
      createdAt: (options.now ?? new Date()).toISOString(),
      files,
    };
    await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return dir;
  } catch (error) {
    options.logger?.warn("导出 system prompt 失败", error);
    return null;
  }
}
