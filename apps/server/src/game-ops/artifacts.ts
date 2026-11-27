/**
 * 调试产物的落盘入口与只读阅览：快照（`logs/worlds`）与故事总结（`logs/stories`）。
 *
 * 这两件事都写文件，所以只服务开发期入口（`agent:game` / `agent:api` / 后台）；
 * 服务端路由调用它们时写的是服务端进程的工作目录，与仓库根的 `logs/` 对齐。
 *
 * 读的部分只做两件事：列出这一局有哪些文件、按名字读一份原文。名字必须先出现在清单里
 * ——白名单，不拼路径，避免 `../` 这类输入碰到别的目录。
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Database } from "../db/pool";
import { gamePlayers, games, users } from "../db/schema";
import { listSnapshots, snapshotsRoot } from "../debug/snapshot";
import { snapshotGame } from "../debug/snapshot-game";
import { dumpStory, storiesRoot } from "../debug/story-dump";
import { runStory } from "../game";
import { GameError } from "../game/errors";
import { findGame } from "../game/persistence/games";
import type { LlmServices } from "./services";

export async function snapshotOp(
  db: Database,
  gameRef: string,
  options: { root?: string } = {},
): Promise<{
  path: string;
  manifest: Record<string, unknown>;
  game: Record<string, unknown>;
}> {
  const result = await snapshotGame(db, gameRef, {
    ...(options.root === undefined ? {} : { root: options.root }),
    action: "snapshot",
  });
  return {
    path: result.snapshot.path,
    manifest: result.snapshot.manifest,
    game: result.state.game,
  };
}

export async function storyOp(
  db: Database,
  gameRef: string,
  services: LlmServices,
): Promise<Record<string, unknown> & { path: string }> {
  const result = await runStory(db, gameRef, { service: services.service });
  const path = await dumpStory({
    gameName: result.gameName,
    gameSlug: result.gameSlug,
    gameStatus: result.gameStatus,
    contentVersion: result.contentVersion,
    version: result.version,
    story: result.story,
    rounds: result.rounds,
    memoriesRead: result.memoriesRead,
    eventsRead: result.eventsRead,
  });
  return { ...result, path };
}

/** 产物落在哪个目录：由「建局者用户名 + 局 slug」决定，和写入口径一致。 */
async function artifactScope(
  db: Database,
  gameRef: string,
): Promise<{ slug: string; username: string }> {
  const game = await findGame(db, gameRef);
  if (!game) {
    throw new GameError("not_found", `游戏不存在: ${gameRef}`);
  }
  const [row] = await db
    .select({ slug: games.slug, username: users.username })
    .from(games)
    .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(games.id, game.id))
    .limit(1);
  if (row === undefined) {
    throw new GameError("invalid_state", `游戏缺少 player: ${game.id}`);
  }
  return row;
}

export type SnapshotEntry = {
  snapshotId: string;
  createdAt: string;
  action: string | null;
  dbVersion: number | null;
  contentVersion: string | null;
  parts: number;
  path: string;
};

/** 这一局的快照清单，新的在前。 */
export async function listSnapshotsOp(
  db: Database,
  gameRef: string,
): Promise<{ dir: string; snapshots: SnapshotEntry[] }> {
  const scope = await artifactScope(db, gameRef);
  const dir = join(snapshotsRoot(), scope.username, scope.slug);
  const rows = await listSnapshots({ user: scope.username, game: scope.slug });

  return {
    dir,
    snapshots: rows
      .map((row) => ({
        snapshotId: row.manifest.snapshotId,
        createdAt: row.manifest.createdAt,
        action: row.manifest.action ?? null,
        dbVersion: row.manifest.dbVersion ?? null,
        contentVersion: row.manifest.contentVersion ?? null,
        parts: row.manifest.parts.length,
        path: row.path,
      }))
      .reverse(),
  };
}

export type SnapshotContent = {
  manifest: Record<string, unknown>;
  /** 读的是哪一份；没指定就是只读清单。 */
  part: string | null;
  content: string | null;
};

/** 读一份快照：给 part 才读原文，否则只回答清单。 */
export async function readSnapshotOp(
  db: Database,
  gameRef: string,
  snapshotId: string,
  part: string | undefined,
): Promise<SnapshotContent> {
  const scope = await artifactScope(db, gameRef);
  const listed = await listSnapshots({ user: scope.username, game: scope.slug });
  const found = listed.find((row) => row.manifest.snapshotId === snapshotId);
  if (found === undefined) {
    throw new GameError("not_found", `快照不存在: ${snapshotId}`);
  }

  const manifest = found.manifest as unknown as Record<string, unknown>;
  if (part === undefined) {
    return { manifest, part: null, content: null };
  }
  // manifest.parts 是写入时校验过的白名单：只读清单里的名字，不拼任意路径。
  if (!found.manifest.parts.includes(part)) {
    throw new GameError("not_found", `快照里没有这一份: ${part}`);
  }
  const content = await readFile(join(found.path, ...part.split("/")), "utf8");
  return { manifest, part, content };
}

export type StoryEntry = {
  name: string;
  /** 文件头里的生成时间；解析不出来时退回文件时间。 */
  createdAt: string;
  title: string;
  version: number | null;
  rounds: number | null;
  path: string;
};

const STORY_SLUG = /^- slug:\s*(.+)$/m;
const STORY_TITLE = /^#\s*(.+)$/m;
const STORY_TIME = /^- 生成时间:\s*(.+)$/m;
const STORY_VERSION = /^- 游戏版本:\s*(\d+)$/m;
const STORY_ROUNDS = /^- agent 轮数:\s*(\d+)$/m;

function storyMeta(name: string, path: string, text: string, mtime: Date): StoryEntry | null {
  const slug = STORY_SLUG.exec(text)?.[1]?.trim();
  if (slug === undefined) {
    return null;
  }
  const version = STORY_VERSION.exec(text)?.[1];
  const rounds = STORY_ROUNDS.exec(text)?.[1];
  return {
    name,
    createdAt: STORY_TIME.exec(text)?.[1]?.trim() ?? mtime.toISOString(),
    title: STORY_TITLE.exec(text)?.[1]?.trim() ?? name,
    version: version === undefined ? null : Number(version),
    rounds: rounds === undefined ? null : Number(rounds),
    path,
  };
}

/** 这一局的故事文件：目录是平的，靠文件头里的 slug 认领。 */
export async function listStoriesOp(
  db: Database,
  gameRef: string,
): Promise<{ dir: string; stories: StoryEntry[] }> {
  const scope = await artifactScope(db, gameRef);
  const dir = storiesRoot();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const stories: StoryEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const path = join(dir, entry.name);
    try {
      const text = await readFile(path, "utf8");
      const meta = storyMeta(entry.name, path, text, new Date());
      if (meta !== null && STORY_SLUG.exec(text)?.[1]?.trim() === scope.slug) {
        stories.push(meta);
      }
    } catch {
      // 坏文件不阻塞清单
    }
  }

  return {
    dir,
    stories: stories.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/** 读一份故事原文：名字必须在清单里。 */
export async function readStoryOp(
  db: Database,
  gameRef: string,
  name: string,
): Promise<{ name: string; path: string; content: string }> {
  const { stories } = await listStoriesOp(db, gameRef);
  const found = stories.find((story) => story.name === name);
  if (found === undefined) {
    throw new GameError("not_found", `故事不存在: ${name}`);
  }
  return { name: found.name, path: found.path, content: await readFile(found.path, "utf8") };
}
