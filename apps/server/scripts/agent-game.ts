/**
 * 数据库 / 快照驱动的开发期 agent CLI。
 *
 * 每次调用是一个一次性进程。数据库命令连接 PostgreSQL，调用共享业务服务层；
 * 文件命令继续提供独立快照的创建、查看、校验与查找。
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { getContentSeed } from "../seeds";
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
import { dumpStory } from "../src/debug/story-dump";
import { DEEPSEEK_SERVICE } from "../src/deepseek";
import {
  type CompactMemoryResult,
  compactAllMemories,
  compactMemory,
  createGame,
  getGameState,
  listPlayerControlledActorIds,
  playerAnnounce,
  playerAttack,
  playerEquip,
  playerGive,
  playerMove,
  playerPickup,
  playerSay,
  playerSteal,
  playerUnequip,
  playerUse,
  playerWait,
  playerWhisper,
  releaseActorControl,
  runAppearanceTurn,
  runNpcTurn,
  runProbe,
  runStageTurn,
  runStory,
  runWorldTurn,
  snapshotGame,
  takeActorControl,
} from "../src/game";
import type { EquipmentSlot, World } from "../src/game/types";
import { EQUIPMENT_SLOTS } from "../src/game/types";
import { parseWorldContent } from "../src/game/world-content";

type Output = Record<string, unknown>;

const options = {
  root: { type: "string" },
  user: { type: "string" },
  game: { type: "string" },
  snapshot: { type: "string" },
  world: { type: "string" },
  "world-file": { type: "string" },
  seed: { type: "string" },
  name: { type: "string" },
  slug: { type: "string" },
  actor: { type: "string" },
  all: { type: "boolean" },
  mode: { type: "string" },
  message: { type: "string" },
  target: { type: "string" },
  to: { type: "string" },
  stage: { type: "string" },
  item: { type: "string" },
  slot: { type: "string" },
  detail: { type: "string" },
  reason: { type: "string" },
  owner: { type: "string" },
  "min-ratio": { type: "string" },
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
      "agent-game create --user <username> (--seed <name> | --world-file <path> | --world '<json>') [--name <gameName>] [--slug <slug>]",
      "agent-game status --game <gameId|slug>",
      "agent-game scene-map --game <gameId|slug>",
      "agent-game npc --game <gameId|slug> --actor <actorId|actorName>",
      "agent-game npc --game <gameId|slug> --all",
      "agent-game stage --game <gameId|slug> --stage <stageId|stageName>",
      "agent-game stage --game <gameId|slug> --all",
      "agent-game world --game <gameId|slug>",
      "agent-game probe --game <gameId|slug> --actor <actorId|actorName> --message <text>",
      "agent-game probe --game <gameId|slug> --stage <stageId|stageName> --message <text>",
      "agent-game take-control --game <gameId|slug> --actor <actorId|actorName>",
      "agent-game release-control --game <gameId|slug> --actor <actorId|actorName>",
      "agent-game player-say --game <gameId|slug> --actor <actorId|actorName> --target <actorName> --message <text> [--reason <text>]",
      "agent-game player-whisper --game <gameId|slug> --actor <actorId|actorName> --target <actorName> --message <text> [--reason <text>]",
      "agent-game player-announce --game <gameId|slug> --actor <actorId|actorName> --message <text> [--reason <text>]",
      "agent-game player-move --game <gameId|slug> --actor <actorId|actorName> --to <stageName>",
      "agent-game player-wait --game <gameId|slug> --actor <actorId|actorName>",
      "agent-game player-attack --game <gameId|slug> --actor <actorId|actorName> --target <actorName>（武器由装备决定）",
      "agent-game player-steal --game <gameId|slug> --actor <actorId|actorName> --target <actorName> --item <itemName>",
      "agent-game player-give --game <gameId|slug> --actor <actorId|actorName> --target <actorName> --item <itemName>",
      "agent-game player-pickup --game <gameId|slug> --actor <actorId|actorName> --item <itemName>",
      "agent-game player-use --game <gameId|slug> --actor <actorId|actorName> --item <itemName> (--target <actorName> | --stage <stageName>) [--detail <text>]",
      "agent-game player-equip --game <gameId|slug> --actor <actorId|actorName> --slot <slot> --item <itemName>",
      "agent-game player-unequip --game <gameId|slug> --actor <actorId|actorName> --slot <slot>",
      "agent-game appearance --game <gameId|slug> (--actor <actorId|actorName> | --all)",
      "agent-game snapshot --game <gameId|slug> [--root <dir>]",
      "agent-game compact --game <gameId|slug> --owner actor --name <actorId|actorName> [--min-ratio <0..1>]",
      "agent-game compact --game <gameId|slug> --owner stage --name <stageId|stageName> [--min-ratio <0..1>]",
      "agent-game compact --game <gameId|slug> --owner world [--min-ratio <0..1>]",
      "agent-game compact --game <gameId|slug> --owner all [--min-ratio <0..1>]",
      "agent-game story --game <gameId|slug>",
    ],
  });
}

/** 读取 player-* 命令共用的 --game / --actor。 */
function requireActorArgs(
  values: Record<string, string | boolean | undefined>,
  command: string,
): { game: string; actor: string } {
  if (typeof values.game !== "string" || typeof values.actor !== "string") {
    throw new Error(`${command} 需要 --game 与 --actor`);
  }
  return { game: values.game, actor: values.actor };
}

/** 读取说话类命令共用的参数；announce 不需要 --target。 */
function requireTalkArgs(
  values: Record<string, string | boolean | undefined>,
  command: string,
  requiresTarget = true,
): { game: string; actor: string; message: string; target: string } {
  const { game, actor } = requireActorArgs(values, command);
  if (typeof values.message !== "string" || values.message.trim().length === 0) {
    throw new Error(`${command} 需要非空 --message`);
  }
  const target = typeof values.target === "string" ? values.target : "";
  if (requiresTarget && target.trim().length === 0) {
    throw new Error(`${command} 需要 --target <actorName>`);
  }
  return { game, actor, message: values.message, target };
}

/** 读取 steal / give 共用的参数。 */
function requireTargetItemArgs(
  values: Record<string, string | boolean | undefined>,
  command: string,
): { game: string; actor: string; target: string; item: string } {
  const { game, actor } = requireActorArgs(values, command);
  const target = typeof values.target === "string" ? values.target : "";
  const item = typeof values.item === "string" ? values.item : "";
  if (target.trim().length === 0 || item.trim().length === 0) {
    throw new Error(`${command} 需要 --target <actorName> 与 --item <itemName>`);
  }
  return { game, actor, target, item };
}

/** 读取换装命令的 --slot，只接受四个槽位。 */
function requireSlot(values: Record<string, string | boolean | undefined>): EquipmentSlot {
  const slot = typeof values.slot === "string" ? values.slot.trim() : "";
  if (!EQUIPMENT_SLOTS.includes(slot as EquipmentSlot)) {
    throw new Error(`--slot 必须是 ${EQUIPMENT_SLOTS.join(" / ")} 之一`);
  }
  return slot as EquipmentSlot;
}

/** 读取 appearance 的 --actor。 */
function requireActorName(
  values: Record<string, string | boolean | undefined>,
  command: string,
): string {
  if (typeof values.actor !== "string" || values.actor.trim().length === 0) {
    throw new Error(`${command} 需要 --actor <actorId|actorName> 或 --all`);
  }
  return values.actor;
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

async function loadCreateWorld(
  values: Record<string, string | boolean | undefined>,
): Promise<World> {
  const inline = values.world;
  const file = values["world-file"];
  const seedName = values.seed;
  const count = [inline, file, seedName].filter((value) => typeof value === "string").length;
  if (count === 0) {
    throw new Error("create 需要 --seed <name>、--world-file <path> 或 --world '<json>' 之一");
  }
  if (count > 1) {
    throw new Error("create 的 --seed、--world-file、--world 只能三选一");
  }
  if (typeof seedName === "string") {
    return parseWorldContent(getContentSeed(seedName).world);
  }
  const raw =
    typeof file === "string"
      ? JSON.parse(await readFile(file, "utf8"))
      : JSON.parse(String(inline));
  return parseWorldContent(raw);
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
    const world = await loadCreateWorld(values);
    const state = await withDatabase((db) =>
      createGame(db, {
        username,
        ...(typeof values.name === "string" ? { name: values.name } : {}),
        ...(typeof values.slug === "string" ? { slug: values.slug } : {}),
        world,
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

  if (command === "scene-map") {
    if (typeof values.game !== "string") {
      throw new Error("scene-map 需要 --game");
    }
    const gameRef = values.game;
    const state = await withDatabase((db) => getGameState(db, gameRef));
    const scenes = Object.fromEntries(
      state.world.stages.map((stage) => [stage.name, stage.actors.map((actor) => actor.name)]),
    );
    emit({ ok: true, action: "scene-map", scenes });
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

  if (command === "player-say" || command === "player-whisper") {
    const { game, actor, message, target } = requireTalkArgs(values, command);
    const reason = typeof values.reason === "string" ? values.reason : undefined;
    const result = await withDatabase((db) =>
      command === "player-say"
        ? playerSay(db, game, actor, {
            message,
            targetActorName: target,
            ...(reason !== undefined ? { reason } : {}),
          })
        : playerWhisper(db, game, actor, {
            message,
            targetActorName: target,
            ...(reason !== undefined ? { reason } : {}),
          }),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-announce") {
    const { game, actor, message } = requireTalkArgs(values, command, false);
    const reason = typeof values.reason === "string" ? values.reason : undefined;
    const result = await withDatabase((db) =>
      playerAnnounce(db, game, actor, {
        message,
        ...(reason !== undefined ? { reason } : {}),
      }),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-move") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.to !== "string" || values.to.trim().length === 0) {
      throw new Error("player-move 需要 --to <stageName>");
    }
    const result = await withDatabase((db) =>
      playerMove(db, game, actor, { targetStageName: values.to as string }),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-wait") {
    const { game, actor } = requireActorArgs(values, command);
    const result = await withDatabase((db) => playerWait(db, game, actor));
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-attack") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.target !== "string" || values.target.trim().length === 0) {
      throw new Error("player-attack 需要 --target <actorName>");
    }
    const result = await withDatabase((db) =>
      playerAttack(
        db,
        game,
        actor,
        { targetActorName: values.target as string },
        { service: DEEPSEEK_SERVICE },
      ),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-steal" || command === "player-give") {
    const { game, actor, target, item } = requireTargetItemArgs(values, command);
    const result = await withDatabase((db) =>
      command === "player-steal"
        ? playerSteal(db, game, actor, { targetActorName: target, itemName: item })
        : playerGive(db, game, actor, { targetActorName: target, itemName: item }),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-pickup") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.item !== "string" || values.item.trim().length === 0) {
      throw new Error("player-pickup 需要 --item <itemName>");
    }
    const result = await withDatabase((db) =>
      playerPickup(db, game, actor, { itemName: values.item as string }),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-use") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.item !== "string" || values.item.trim().length === 0) {
      throw new Error("player-use 需要 --item <itemName>");
    }
    const targetActorName = typeof values.target === "string" ? values.target : undefined;
    const targetStageName = typeof values.stage === "string" ? values.stage : undefined;
    const targetDetail = typeof values.detail === "string" ? values.detail : undefined;
    if ((targetActorName === undefined) === (targetStageName === undefined)) {
      throw new Error("player-use 需要 --target 或 --stage 二选一");
    }
    if (targetDetail !== undefined && targetStageName === undefined) {
      throw new Error("player-use 的 --detail 只能与 --stage 一起使用");
    }
    const result = await withDatabase((db) =>
      playerUse(
        db,
        game,
        actor,
        {
          itemName: values.item as string,
          ...(targetActorName !== undefined ? { targetActorName } : {}),
          ...(targetStageName !== undefined ? { targetStageName } : {}),
          ...(targetDetail !== undefined ? { targetDetail } : {}),
        },
        { service: DEEPSEEK_SERVICE },
      ),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-equip") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.item !== "string" || values.item.trim().length === 0) {
      throw new Error("player-equip 需要 --item <itemName>");
    }
    const result = await withDatabase((db) =>
      playerEquip(db, game, actor, {
        itemName: values.item as string,
        slot: requireSlot(values),
      }),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "player-unequip") {
    const { game, actor } = requireActorArgs(values, command);
    const result = await withDatabase((db) =>
      playerUnequip(db, game, actor, { slot: requireSlot(values) }),
    );
    emit({ ok: true, action: command, plan: result.plan, state: result.state });
    return;
  }

  if (command === "appearance") {
    if (typeof values.game !== "string") {
      throw new Error("appearance 需要 --game <gameId|slug>");
    }
    const actorNames = values.all === true ? null : [requireActorName(values, "appearance")];
    const results = await withDatabase(async (db) => {
      const state = await getGameState(db, values.game as string);
      const targets =
        actorNames ??
        state.world.stages.flatMap((stage) => stage.actors).map((actor) => actor.name);
      const collected: Output[] = [];
      for (const actorName of targets) {
        const result = await runAppearanceTurn(db, values.game as string, actorName, {
          service: DEEPSEEK_SERVICE,
        });
        collected.push({ actor: actorName, ok: result.ok, appearance: result.appearance });
      }
      return collected;
    });
    emit({ ok: results.every((result) => result.ok === true), action: command, results });
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
        .flatMap((stage) =>
          stage.actors.filter((actor) => actor.status === "alive").map((actor) => actor.id),
        )
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

  if (command === "world") {
    if (typeof values.game !== "string") {
      throw new Error("world 需要 --game");
    }
    const result = await withDatabase((db) =>
      runWorldTurn(db, values.game as string, { service: DEEPSEEK_SERVICE }),
    );
    emit({
      ok: true,
      action: "world",
      plan: result.plan,
      loopSuccess: result.loopSuccess,
      state: result.state,
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

  if (command === "story") {
    if (typeof values.game !== "string") {
      throw new Error("story 需要 --game");
    }
    const result = await withDatabase((db) =>
      runStory(db, values.game as string, { service: DEEPSEEK_SERVICE }),
    );
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
    emit({ ok: true, action: "story", ...result, path });
    return;
  }

  if (command === "compact") {
    if (typeof values.game !== "string") {
      throw new Error("compact 需要 --game");
    }
    const owner = typeof values.owner === "string" ? values.owner : "";
    if (!["actor", "stage", "world", "all"].includes(owner)) {
      throw new Error("compact 需要 --owner actor|stage|world|all");
    }
    const rawMinRatio = values["min-ratio"];
    const minRatio =
      typeof rawMinRatio === "string" && rawMinRatio.trim().length > 0
        ? Number(rawMinRatio)
        : undefined;
    if (minRatio !== undefined && !Number.isFinite(minRatio)) {
      throw new Error("compact 的 --min-ratio 必须是数字");
    }
    const gameRef = values.game;
    const name = typeof values.name === "string" ? values.name : "";
    if ((owner === "actor" || owner === "stage") && name.trim().length === 0) {
      throw new Error(`compact --owner ${owner} 需要 --name`);
    }
    const compactOptions = {
      service: DEEPSEEK_SERVICE,
      ...(minRatio !== undefined ? { minRatio } : {}),
    };
    const results = await withDatabase<CompactMemoryResult[]>((db) => {
      if (owner === "all") {
        return compactAllMemories(db, gameRef, compactOptions);
      }
      if (owner === "world") {
        return compactMemory(db, gameRef, { ownerType: "world" }, compactOptions).then((result) => [
          result,
        ]);
      }
      if (owner === "actor") {
        return compactMemory(db, gameRef, { ownerType: "actor", ref: name }, compactOptions).then(
          (result) => [result],
        );
      }
      return compactMemory(db, gameRef, { ownerType: "stage", ref: name }, compactOptions).then(
        (result) => [result],
      );
    });
    emit({ ok: true, action: "compact", results });
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
