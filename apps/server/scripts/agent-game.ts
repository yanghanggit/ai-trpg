/**
 * 数据库 / 快照驱动的开发期 agent CLI。
 *
 * 每次调用是一个一次性进程。数据库命令连接 PostgreSQL，调用共享业务服务层；
 * 文件命令继续提供独立快照的创建、查看、校验与查找。
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DARK_FANTASY_WORLD } from "../seeds/dark-fantasy";
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
import { DEEPSEEK_SERVICE } from "../src/deepseek";
import {
  createGame,
  getGameState,
  isCommunicationAction,
  listPlayerControlledActorIds,
  playerAttack,
  playerCommunicate,
  playerInteract,
  playerMove,
  releaseActorControl,
  runNpcTurn,
  runProbe,
  runStageTurn,
  snapshotGame,
  takeActorControl,
} from "../src/game";

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
  actor: { type: "string" },
  all: { type: "boolean" },
  mode: { type: "string" },
  message: { type: "string" },
  target: { type: "string" },
  to: { type: "string" },
  stage: { type: "string" },
  skill: { type: "string" },
  item: { type: "string" },
  reason: { type: "string" },
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
      "agent-game npc --game <gameId|slug> --actor <actorId|actorName>",
      "agent-game npc --game <gameId|slug> --all",
      "agent-game stage --game <gameId|slug> --stage <stageId|stageName>",
      "agent-game stage --game <gameId|slug> --all",
      "agent-game probe --game <gameId|slug> --actor <actorId|actorName> --message <text>",
      "agent-game probe --game <gameId|slug> --stage <stageId|stageName> --message <text>",
      "agent-game take-control --game <gameId|slug> --actor <actorId|actorName>",
      "agent-game release-control --game <gameId|slug> --actor <actorId|actorName>",
      "agent-game player-communicate --game <gameId|slug> --actor <actorId|actorName> --mode say|whisper|announce [--target <actorName>] [--reason <text>] --message <text>",
      "agent-game player-attack --game <gameId|slug> --actor <actorId|actorName> --target <actorName> [--item <itemName>]",
      "agent-game player-move --game <gameId|slug> --actor <actorId|actorName> --to <stageName>",
      "agent-game player-interact --game <gameId|slug> --actor <actorId|actorName> --skill <key> [--target <actorName>] [--stage <stageName>] [--item <itemName>]",
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
        world: DARK_FANTASY_WORLD,
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

  if (command === "take-control" || command === "release-control") {
    if (typeof values.game !== "string" || typeof values.actor !== "string") {
      throw new Error(`${command} 需要 --game 与 --actor`);
    }
    const gameRef = values.game;
    const actorRef = values.actor;
    const result = await withDatabase(async (db) => {
      if (command === "take-control") {
        return takeActorControl(db, gameRef, actorRef);
      }
      await releaseActorControl(db, gameRef, actorRef);
      return { released: true };
    });
    emit({ ok: true, action: command, result });
    return;
  }

  if (command === "player-communicate") {
    if (typeof values.game !== "string" || typeof values.actor !== "string") {
      throw new Error("player-communicate 需要 --game 与 --actor");
    }
    if (!isCommunicationAction(values.mode)) {
      throw new Error("player-communicate 需要 --mode say|whisper|announce");
    }
    if (typeof values.message !== "string" || values.message.trim().length === 0) {
      throw new Error("player-communicate 需要非空 --message");
    }
    if ((values.mode === "say" || values.mode === "whisper") && typeof values.target !== "string") {
      throw new Error(`${values.mode} 需要 --target`);
    }

    const gameRef = values.game;
    const actorRef = values.actor;
    const mode = values.mode;
    const message = values.message;
    const targetActorName = typeof values.target === "string" ? values.target : undefined;
    const reason = typeof values.reason === "string" ? values.reason : undefined;
    const result = await withDatabase((db) =>
      playerCommunicate(db, gameRef, actorRef, {
        mode,
        message,
        ...(targetActorName !== undefined ? { targetActorName } : {}),
        ...(reason !== undefined ? { reason } : {}),
      }),
    );
    emit({
      ok: true,
      action: "player-communicate",
      plan: result.plan,
      state: result.state,
    });
    return;
  }

  if (command === "player-move") {
    if (typeof values.game !== "string" || typeof values.actor !== "string") {
      throw new Error("player-move 需要 --game 与 --actor");
    }
    if (typeof values.to !== "string" || values.to.trim().length === 0) {
      throw new Error("player-move 需要 --to <stageName>");
    }

    const gameRef = values.game;
    const actorRef = values.actor;
    const targetStageName = values.to;
    const result = await withDatabase((db) =>
      playerMove(db, gameRef, actorRef, { targetStageName }),
    );
    emit({
      ok: true,
      action: "player-move",
      plan: result.plan,
      state: result.state,
    });
    return;
  }

  if (command === "player-interact") {
    if (typeof values.game !== "string" || typeof values.actor !== "string") {
      throw new Error("player-interact 需要 --game 与 --actor");
    }
    if (typeof values.skill !== "string" || values.skill.trim().length === 0) {
      throw new Error("player-interact 需要 --skill");
    }

    const gameRef = values.game;
    const actorRef = values.actor;
    const skillKey = values.skill;
    const result = await withDatabase((db) =>
      playerInteract(db, gameRef, actorRef, {
        skillKey,
        ...(typeof values.target === "string" ? { targetActorName: values.target } : {}),
        ...(typeof values.stage === "string" ? { targetStageName: values.stage } : {}),
        ...(typeof values.item === "string" ? { itemName: values.item } : {}),
        ...(typeof values.item === "string" ? { itemNames: [values.item] } : {}),
      }),
    );
    emit({
      ok: true,
      action: "player-interact",
      plan: result.plan,
      state: result.state,
    });
    return;
  }

  if (command === "player-attack") {
    if (typeof values.game !== "string" || typeof values.actor !== "string") {
      throw new Error("player-attack 需要 --game 与 --actor");
    }
    if (typeof values.target !== "string" || values.target.trim().length === 0) {
      throw new Error("player-attack 需要 --target");
    }

    const gameRef = values.game;
    const actorRef = values.actor;
    const targetActorName = values.target;
    const itemNames = typeof values.item === "string" ? [values.item] : [];
    const result = await withDatabase((db) =>
      playerAttack(db, gameRef, actorRef, { targetActorName, itemNames }),
    );
    emit({
      ok: true,
      action: "player-attack",
      plan: result.plan,
      state: result.state,
    });
    return;
  }

  if (command === "npc") {
    if (typeof values.game !== "string") {
      throw new Error("npc 需要 --game");
    }
    const gameRef = values.game;
    const actorRef = typeof values.actor === "string" ? values.actor : undefined;
    const all = values.all === true;
    if (!all && actorRef === undefined) {
      throw new Error("npc 需要 --actor，或使用 --all");
    }

    const results = await withDatabase(async (db) => {
      if (!all && actorRef !== undefined) {
        return [await runNpcTurn(db, gameRef, actorRef, { service: DEEPSEEK_SERVICE })];
      }
      const state = await getGameState(db, gameRef);
      const controlled = new Set(await listPlayerControlledActorIds(db, state.game.id));
      const actorIds = state.world.stages
        .flatMap((stage) => stage.actors.filter((actor) => !actor.death).map((actor) => actor.id))
        .filter((actorId) => !controlled.has(actorId));
      const output = [];
      for (const actorId of actorIds) {
        output.push(await runNpcTurn(db, gameRef, actorId, { service: DEEPSEEK_SERVICE }));
      }
      return output;
    });

    emit({
      ok: true,
      action: "npc",
      results: results.map((result) => ({
        ok: result.ok,
        plan: result.plan,
        loopSuccess: result.loopSuccess,
        state: result.state,
      })),
    });
    return;
  }

  if (command === "stage") {
    if (typeof values.game !== "string") {
      throw new Error("stage 需要 --game");
    }
    const gameRef = values.game;
    const stageRef = typeof values.stage === "string" ? values.stage : undefined;
    const all = values.all === true;
    if (!all && stageRef === undefined) {
      throw new Error("stage 需要 --stage，或使用 --all");
    }

    const results = await withDatabase(async (db) => {
      if (!all && stageRef !== undefined) {
        return [await runStageTurn(db, gameRef, stageRef, { service: DEEPSEEK_SERVICE })];
      }
      const state = await getGameState(db, gameRef);
      const output = [];
      for (const stage of state.world.stages) {
        output.push(await runStageTurn(db, gameRef, stage.id, { service: DEEPSEEK_SERVICE }));
      }
      return output;
    });

    emit({
      ok: true,
      action: "stage",
      results: results.map((result) => ({
        ok: result.ok,
        plan: result.plan,
        loopSuccess: result.loopSuccess,
        state: result.state,
      })),
    });
    return;
  }

  if (command === "probe") {
    if (typeof values.game !== "string") {
      throw new Error("probe 需要 --game");
    }
    if (typeof values.message !== "string" || values.message.trim().length === 0) {
      throw new Error("probe 需要非空 --message");
    }
    const actorRef = typeof values.actor === "string" ? values.actor : undefined;
    const stageRef = typeof values.stage === "string" ? values.stage : undefined;
    if ((actorRef === undefined) === (stageRef === undefined)) {
      throw new Error("probe 需要 --actor 或 --stage 二选一");
    }

    const gameRef = values.game;
    const message = values.message;
    const target =
      actorRef !== undefined
        ? { type: "actor" as const, actorRef }
        : { type: "stage" as const, stageRef: stageRef as string };
    const result = await withDatabase((db) =>
      runProbe(db, gameRef, { service: DEEPSEEK_SERVICE, target, message }),
    );
    emit({ ok: true, action: "probe", ...result });
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
