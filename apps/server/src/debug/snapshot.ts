/**
 * 开发期世界快照存储。
 *
 * 一份快照是一个完整、自足的状态切片：读取任意一份即可继续推进，不依赖进程内记忆。
 * 目录按 `worlds/<user>/<game>/<snapshotId>/` 组织，人类可读，供 agent 与开发者审阅。
 * 数据库是权威状态源；快照是提交后的只读投影，不是写入源。
 *
 * 写入采用「临时目录 → 原子 rename」：动作失败不会留下半份快照。
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "./paths";

export const SNAPSHOT_SCHEMA_VERSION = 1;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SessionEvent = {
  sequence: number;
  type: string;
  at: string;
  payload?: JsonValue;
};

export type SnapshotManifest = {
  schemaVersion: 1;
  user: string;
  game: string;
  snapshotId: string;
  createdAt: string;
  action?: string;
  parent?: string;
  parts: string[];
  source?: "file" | "db";
  gameId?: string;
  dbVersion?: number;
  contentVersion?: string;
};

export type SnapshotSummary = {
  path: string;
  manifest: SnapshotManifest;
};

export type Snapshot = SnapshotSummary & {
  world: JsonValue;
  session: SessionEvent[];
  parts: Record<string, JsonValue>;
};

export type SaveSnapshotInput = {
  root?: string;
  user: string;
  game: string;
  world: JsonValue;
  session?: readonly SessionEvent[];
  /** 可选的领域文件：key 是快照内的相对路径（如 `entities/角色.json`）。 */
  parts?: Readonly<Record<string, JsonValue>>;
  action?: string;
  parent?: string;
  snapshotId?: string;
  source?: "file" | "db";
  gameId?: string;
  dbVersion?: number;
  contentVersion?: string;
  now?: Date;
};

export type ListSnapshotsOptions = {
  root?: string;
  user?: string;
  game?: string;
};

const sessionEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  type: z.string().min(1),
  at: z.iso.datetime(),
  payload: z.unknown().optional(),
});

const manifestSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  user: z.string().min(1),
  game: z.string().min(1),
  snapshotId: z.string().min(1),
  createdAt: z.iso.datetime(),
  action: z.string().optional(),
  parent: z.string().optional(),
  parts: z.array(z.string()),
  source: z.enum(["file", "db"]).optional(),
  gameId: z.uuid().optional(),
  dbVersion: z.number().int().nonnegative().optional(),
  contentVersion: z.string().min(1).optional(),
});

function assertSafeSegment(name: string, value: string): void {
  if (value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`${name} 不能为空或带首尾空白`);
  }
  if (value === "." || value === ".." || /[/\\\0:*?"<>|]/.test(value)) {
    throw new Error(`${name} 不能包含路径分隔符、Windows 保留字符或指代当前/上级目录`);
  }
}

function assertSafePartPath(path: string): void {
  if (path.endsWith("/") || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`非法的 parts 路径: ${path}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`非法的 parts 路径: ${path}`);
  }
  if (!path.endsWith(".json")) {
    throw new Error(`parts 文件必须使用 .json 后缀: ${path}`);
  }
  if (path === "manifest.json" || path === "world.json" || path === "session.jsonl") {
    throw new Error(`parts 路径与保留文件冲突: ${path}`);
  }
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** 本地时间戳；同一毫秒内重复创建会显式失败，而不是覆盖旧快照。 */
export function formatSnapshotId(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

export function snapshotsRoot(root?: string): string {
  if (root !== undefined) {
    return resolve(root);
  }
  if (process.env.WORLDS_DIR) {
    return resolve(process.env.WORLDS_DIR);
  }
  return join(findRepoRoot(), "worlds");
}

function snapshotPath(root: string, user: string, game: string, snapshotId: string): string {
  return join(root, user, game, snapshotId);
}

function sessionJsonl(session: readonly SessionEvent[]): string {
  if (session.length === 0) {
    return "";
  }
  return `${session.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

/** 保存一份完整快照；返回落盘后的路径与内容。 */
export async function saveSnapshot(input: SaveSnapshotInput): Promise<Snapshot> {
  assertSafeSegment("user", input.user);
  assertSafeSegment("game", input.game);

  const now = input.now ?? new Date();
  const snapshotId = input.snapshotId ?? formatSnapshotId(now);
  assertSafeSegment("snapshotId", snapshotId);

  const parts = input.parts ?? {};
  const partPaths = Object.keys(parts).sort();
  for (const path of partPaths) {
    assertSafePartPath(path);
  }

  const root = snapshotsRoot(input.root);
  const parent = join(root, input.user, input.game);
  const target = snapshotPath(root, input.user, input.game, snapshotId);
  const temp = join(parent, `.${snapshotId}.tmp-${process.pid}-${randomUUID()}`);

  const manifest: SnapshotManifest = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    user: input.user,
    game: input.game,
    snapshotId,
    createdAt: now.toISOString(),
    ...(input.action !== undefined ? { action: input.action } : {}),
    ...(input.parent !== undefined ? { parent: input.parent } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.gameId !== undefined ? { gameId: input.gameId } : {}),
    ...(input.dbVersion !== undefined ? { dbVersion: input.dbVersion } : {}),
    ...(input.contentVersion !== undefined ? { contentVersion: input.contentVersion } : {}),
    parts: partPaths,
  };
  const session = input.session ?? [];

  await mkdir(parent, { recursive: true });

  try {
    await lstat(target);
    throw new Error(`快照已存在: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(temp, { recursive: true });

  try {
    await writeFile(join(temp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(join(temp, "world.json"), `${JSON.stringify(input.world, null, 2)}\n`, "utf8");
    await writeFile(join(temp, "session.jsonl"), sessionJsonl(session), "utf8");

    for (const path of partPaths) {
      const value = parts[path];
      if (value === undefined) {
        throw new Error(`parts 缺少内容: ${path}`);
      }
      const targetPath = join(temp, ...path.split("/"));
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }

    await rename(temp, target);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }

  return { path: target, manifest, world: input.world, session: [...session], parts: { ...parts } };
}

/** 读取任意一份快照；缺失或不符合 schema 时直接失败。 */
export async function loadSnapshot(snapshotDir: string): Promise<Snapshot> {
  const path = resolve(snapshotDir);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(join(path, "manifest.json"), "utf8")),
  );

  const world = JSON.parse(await readFile(join(path, "world.json"), "utf8")) as JsonValue;
  const sessionRaw = await readFile(join(path, "session.jsonl"), "utf8");
  const session = sessionRaw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => sessionEventSchema.parse(JSON.parse(line)) as SessionEvent);

  const parts: Record<string, JsonValue> = {};
  for (const part of manifest.parts) {
    assertSafePartPath(part);
    parts[part] = JSON.parse(await readFile(join(path, ...part.split("/")), "utf8")) as JsonValue;
  }

  return { path, manifest, world, session, parts };
}

/** 列出快照，按创建时间升序；临时目录与坏快照会被跳过。 */
export async function listSnapshots(
  options: ListSnapshotsOptions = {},
): Promise<SnapshotSummary[]> {
  const root = snapshotsRoot(options.root);
  if (options.user !== undefined) {
    assertSafeSegment("user", options.user);
  }
  if (options.game !== undefined) {
    assertSafeSegment("game", options.game);
  }

  const users = options.user ? [options.user] : await listDirectories(root);
  const summaries: SnapshotSummary[] = [];

  for (const user of users) {
    const games = options.game ? [options.game] : await listDirectories(join(root, user));
    for (const game of games) {
      const directory = join(root, user, game);
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) {
          continue;
        }
        try {
          const manifest = manifestSchema.parse(
            JSON.parse(await readFile(join(directory, entry.name, "manifest.json"), "utf8")),
          );
          summaries.push({ path: join(directory, entry.name), manifest });
        } catch {
          // 坏快照不阻塞列表；需要严格校验时用 loadSnapshot。
        }
      }
    }
  }

  return summaries.sort((a, b) =>
    a.manifest.createdAt === b.manifest.createdAt
      ? a.path.localeCompare(b.path)
      : a.manifest.createdAt.localeCompare(b.manifest.createdAt),
  );
}

async function listDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/** 返回指定 user/game 的最新快照；不存在时返回 undefined。 */
export async function findLatestSnapshot(
  options: ListSnapshotsOptions & { user: string; game: string },
): Promise<SnapshotSummary | undefined> {
  const snapshots = await listSnapshots(options);
  return snapshots.at(-1);
}
