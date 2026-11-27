/**
 * 建局时导出的 system prompt 只读阅览（`logs/prompts`）。
 *
 * 这一份产物是「这一局建成时，模型实际拿到的系统提示词原文」：world 一份、各职能一份、
 * 各舞台一份、各角色一份。它不随回合变，也不进数据库——所以这里只读文件。
 *
 * 认领靠容器里的 `manifest.json`：目录名只有时间、世界名与内容版本，同剧本的多个局
 * 会长得一模一样；写文件的人把 slug 记进 manifest，读的人按它挑。
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "../db/pool";
import {
  MANIFEST_FILE,
  type PromptDumpFile,
  type PromptDumpManifest,
  promptsRoot,
} from "../debug/prompt-dump";
import { GameError } from "../game/errors";
import { findGame } from "../game/persistence/games";

export type PromptBundleEntry = {
  /** 容器目录名，也是这一份的地址。 */
  id: string;
  createdAt: string;
  world: string;
  contentVersion: string;
  bytes: number;
  counts: { world: number; functions: number; stages: number; actors: number };
  path: string;
};

export type PromptBundleFile = PromptDumpFile & { content: string };

export type PromptBundle = {
  id: string;
  createdAt: string;
  world: string;
  contentVersion: string;
  path: string;
  files: PromptBundleFile[];
};

async function readManifest(dir: string): Promise<PromptDumpManifest | null> {
  try {
    const text = await readFile(join(dir, MANIFEST_FILE), "utf8");
    const parsed = JSON.parse(text) as PromptDumpManifest;
    return typeof parsed.game?.slug === "string" && Array.isArray(parsed.files) ? parsed : null;
  } catch {
    // 没有 manifest 的目录不是导出容器（也可能是手放的），不当成一份。
    return null;
  }
}

function counts(files: readonly PromptDumpFile[]): PromptBundleEntry["counts"] {
  const tally = { world: 0, functions: 0, stages: 0, actors: 0 };
  for (const file of files) {
    if (file.kind === "world") tally.world += 1;
    if (file.kind === "function") tally.functions += 1;
    if (file.kind === "stage") tally.stages += 1;
    if (file.kind === "actor") tally.actors += 1;
  }
  return tally;
}

/** 这一局导出过哪几份：新的在前。 */
export async function listPromptBundlesOp(
  db: Database,
  gameRef: string,
): Promise<{ dir: string; bundles: PromptBundleEntry[] }> {
  const game = await findGame(db, gameRef);
  if (!game) {
    throw new GameError("not_found", `游戏不存在: ${gameRef}`);
  }

  const dir = promptsRoot();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const bundles: PromptBundleEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(dir, entry.name);
    const manifest = await readManifest(path);
    if (manifest === null || manifest.game.slug !== game.slug) {
      continue;
    }
    bundles.push({
      id: entry.name,
      createdAt: manifest.createdAt,
      world: manifest.world.name,
      contentVersion: manifest.world.contentVersion,
      bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      counts: counts(manifest.files),
      path,
    });
  }

  return {
    dir,
    bundles: bundles.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}

/** 读一份导出的全部文件：清单来自 manifest，正文照清单取。 */
export async function readPromptBundleOp(
  db: Database,
  gameRef: string,
  id: string,
): Promise<PromptBundle> {
  const { bundles } = await listPromptBundlesOp(db, gameRef);
  const found = bundles.find((bundle) => bundle.id === id);
  if (found === undefined) {
    throw new GameError("not_found", `没有这一份提示词导出: ${id}`);
  }

  const manifest = await readManifest(found.path);
  if (manifest === null) {
    throw new GameError("not_found", `这一份缺 manifest: ${id}`);
  }

  const files: PromptBundleFile[] = [];
  for (const file of manifest.files) {
    try {
      const content = await readFile(join(found.path, ...file.path.split("/")), "utf8");
      files.push({ ...file, content });
    } catch {
      // 少一份不影响其余：清单里留着，正文标成读不到由页面显示。
      files.push({ ...file, content: "" });
    }
  }

  return {
    id: found.id,
    createdAt: found.createdAt,
    world: found.world,
    contentVersion: found.contentVersion,
    path: found.path,
    files,
  };
}
