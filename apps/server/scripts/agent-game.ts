/**
 * 快照驱动的开发期 agent CLI。
 *
 * 每次调用是一个一次性进程。数据库命令连接 PostgreSQL，调用共享业务服务层；
 * 文件命令继续提供独立快照的创建、查看、校验与查找。
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DARK_FANTASY_SEED } from "../seeds/dark-fantasy";
import { openDatabase } from "../src/db/connect";
import type { Database } from "../src/db/pool";
import {
  findLatestSnapshot,
  type JsonValue,
  listSnapshots,
  loadSnapshot,
  type SessionEvent,
  type Snapshot,
  saveSnapshot,
} from "../src/debug/snapshot";
import { createGame, getGameState, runAction, snapshotGame } from "../src/game";

type Output = Record<string, unknown>;

const options = {
  root: { type: "string" },
  user: { type: "string" },
  game: { type: "string" },
  snapshot: { type: "string" },
  world: { type: "string" },
  "world-file": { type: "string" },
  name: { type: "string" },
  slug: { type: "string" },
  action: { type: "string" },
  to: { type: "string" },
} as const;

function emit(payload: Output, exitCode = 0): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

function fail(action: string, error: unknown): void {
  emit(
    {
      ok: false,
      action,
      error: error instanceof Error ? error.message : String(error),
    },
    1,
  );
}

function usage(): void {
  emit({
    ok: true,
    usage: [
      "agent-game new --user <user> --game <game> [--world '<json>' | --world-file <path>] [--root <dir>]",
      "agent-game list [--user <user>] [--game <game>] [--root <dir>]",
      "agent-game latest --user <user> --game <game> [--root <dir>]",
      "agent-game show --snapshot <dir>",
      "agent-game validate --snapshot <dir>",
      "agent-game create --user <username> [--name <gameName>] [--slug <slug>]",
      "agent-game status --game <gameId|slug>",
      "agent-game act --game <gameId|slug> --action move --to <stageId|stageName>",
      "agent-game snapshot --game <gameId|slug> [--root <dir>]",
    ],
  });
}

function parseWorld(values: Record<string, string | boolean | undefined>): Promise<JsonValue> {
  const inline = values.world;
  const file = values["world-file"];
  if (typeof inline === "string" && typeof file === "string") {
    throw new Error("--world 与 --world-file 只能二选一");
  }
  if (typeof file === "string") {
    return readFile(file, "utf8").then((raw) => JSON.parse(raw) as JsonValue);
  }
  if (typeof inline === "string") {
    return Promise.resolve(JSON.parse(inline) as JsonValue);
  }
  return Promise.resolve({});
}

async function withDatabase<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const { db, pool } = openDatabase();
  try {
    return await fn(db);
  } finally {
    await pool.end();
  }
}

function snapshotInfo(snapshot: Snapshot): Output {
  return {
    path: snapshot.path,
    manifest: snapshot.manifest,
    sessionEvents: snapshot.session.length,
    parts: Object.keys(snapshot.parts),
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options,
  });
  const command = parsed.positionals[0];
  const values = parsed.values;
  const root = typeof values.root === "string" ? values.root : undefined;

  if (!command) {
    usage();
    return;
  }

  if (command === "create") {
    if (typeof values.user !== "string") {
      throw new Error("create 需要 --user");
    }
    const username = values.user;
    const state = await withDatabase((db) =>
      createGame(db, {
        username,
        ...(typeof values.name === "string" ? { name: values.name } : {}),
        ...(typeof values.slug === "string" ? { slug: values.slug } : {}),
        seed: DARK_FANTASY_SEED,
      }),
    );
    emit({ ok: true, action: "create", state });
    return;
  }

  if (command === "status") {
    if (typeof values.game !== "string") {
      throw new Error("status 需要 --game");
    }
    const gameRef = values.game;
    const state = await withDatabase((db) => getGameState(db, gameRef));
    emit({ ok: true, action: "status", state });
    return;
  }

  if (command === "act") {
    if (typeof values.game !== "string") {
      throw new Error("act 需要 --game");
    }
    if (values.action !== undefined && values.action !== "move") {
      throw new Error(`暂不支持的动作: ${String(values.action)}`);
    }
    if (typeof values.to !== "string") {
      throw new Error("act 需要 --to");
    }
    const gameRef = values.game;
    const to = values.to;
    const state = await withDatabase((db) => runAction(db, gameRef, { type: "move", to }));
    emit({ ok: true, action: "act", result: "move", state });
    return;
  }

  if (command === "snapshot") {
    if (typeof values.game !== "string") {
      throw new Error("snapshot 需要 --game");
    }
    const gameRef = values.game;
    const result = await withDatabase((db) =>
      snapshotGame(db, gameRef, { root, action: "snapshot" }),
    );
    emit({
      ok: true,
      action: "snapshot",
      path: result.snapshot.path,
      manifest: result.snapshot.manifest,
      game: result.state.game,
    });
    return;
  }

  if (command === "new") {
    if (typeof values.user !== "string" || typeof values.game !== "string") {
      throw new Error("new 需要 --user 与 --game");
    }
    const now = new Date();
    const world = await parseWorld(values);
    const session: SessionEvent[] = [
      {
        sequence: 1,
        type: "session.created",
        at: now.toISOString(),
        payload: { user: values.user, game: values.game },
      },
    ];
    const snapshot = await saveSnapshot({
      root,
      user: values.user,
      game: values.game,
      world,
      session,
      action: "new",
      now,
    });
    emit({ ok: true, action: "new", snapshot: snapshotInfo(snapshot) });
    return;
  }

  if (command === "list") {
    const snapshots = await listSnapshots({
      root,
      ...(typeof values.user === "string" ? { user: values.user } : {}),
      ...(typeof values.game === "string" ? { game: values.game } : {}),
    });
    emit({
      ok: true,
      action: "list",
      snapshots: snapshots.map(({ path, manifest }) => ({
        path,
        user: manifest.user,
        game: manifest.game,
        snapshotId: manifest.snapshotId,
        createdAt: manifest.createdAt,
        action: manifest.action,
      })),
    });
    return;
  }

  if (command === "latest") {
    if (typeof values.user !== "string" || typeof values.game !== "string") {
      throw new Error("latest 需要 --user 与 --game");
    }
    const latest = await findLatestSnapshot({ root, user: values.user, game: values.game });
    if (!latest) {
      emit({ ok: false, action: "latest", error: "没有找到快照" }, 1);
      return;
    }
    emit({
      ok: true,
      action: "latest",
      snapshot: { path: latest.path, manifest: latest.manifest },
    });
    return;
  }

  if (command === "show" || command === "validate") {
    if (typeof values.snapshot !== "string") {
      throw new Error(`${command} 需要 --snapshot`);
    }
    const snapshot = await loadSnapshot(values.snapshot);
    if (command === "validate") {
      emit({ ok: true, action: "validate", snapshot: snapshotInfo(snapshot) });
      return;
    }
    emit({
      ok: true,
      action: "show",
      snapshot: {
        path: snapshot.path,
        manifest: snapshot.manifest,
        world: snapshot.world,
        session: snapshot.session,
        parts: snapshot.parts,
      },
    });
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

main().catch((error: unknown) => fail("agent-game", error));
