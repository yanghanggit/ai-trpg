/**
 * 数据库 / 快照驱动的开发期 agent CLI。
 *
 * 每次调用是一个一次性进程。数据库命令连接 PostgreSQL，调用共享业务服务层；
 * 文件命令继续提供独立快照的创建、查看、校验与查找。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import pino from "pino";
import { getContentPack } from "../seeds";
import { readContentPackFile } from "../src/content-pack";
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
import {
  gcTrace,
  listTurns,
  readTurn,
  renderTurnText,
  tailEvents,
  traceSchema,
  traceStats,
} from "../src/debug/trace";
import { DEEPSEEK_SERVICE } from "../src/deepseek";
import {
  type CompactMemoryResult,
  compactAllMemories,
  compactMemory,
  createGame,
  getGameState,
  isAlive,
  listPlayerControlledActorIds,
  playerAnnounce,
  playerBrawl,
  playerEquip,
  playerGive,
  playerMove,
  playerPickup,
  playerRememberIdentity,
  playerSay,
  playerSteal,
  playerStrike,
  playerTeleport,
  playerUnequip,
  playerUse,
  playerWait,
  playerWhisper,
  refreshAppearances,
  releaseActorControl,
  runAppearanceTurn,
  runNpcTurn,
  runProbe,
  runStageTurn,
  runStory,
  runWorldTurn,
  settleDeaths,
  snapshotGame,
  takeActorControl,
} from "../src/game";
import type { ActorTurnResult, EquipmentSlot, World } from "../src/game/types";
import { EQUIPMENT_SLOTS } from "../src/game/types";
import { parseWorldContent } from "../src/game/world-content";
import { loggerFromPino } from "../src/logging";

type Output = Record<string, unknown>;

const options = {
  root: { type: "string" },
  user: { type: "string" },
  game: { type: "string" },
  snapshot: { type: "string" },
  world: { type: "string" },
  "world-file": { type: "string" },
  "content-file": { type: "string" },
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
  anchor: { type: "string" },
  as: { type: "string" },
  reason: { type: "string" },
  owner: { type: "string" },
  "min-ratio": { type: "string" },
  turn: { type: "string" },
  limit: { type: "string" },
  since: { type: "string" },
  before: { type: "string" },
  out: { type: "string" },
  latest: { type: "boolean" },
  delete: { type: "boolean" },
  "dry-run": { type: "boolean" },
} as const;

/** CLI 的进程日志：pino + pretty，写 stderr，stdout 保持只出 JSON。 */
const cliLogger = loggerFromPino(
  pino({
    level: process.env.LOG_LEVEL ?? "info",
    transport: {
      target: "pino-pretty",
      options: { destination: 2, translateTime: "SYS:standard", ignore: "pid,hostname" },
    },
  }),
);

/** 行动回合的输出；死亡阶段的结果（失败与重试信息）一并交给上层。 */
function emitTurn(command: string, result: ActorTurnResult): void {
  emit({
    ok: true,
    action: command,
    plan: result.plan,
    state: result.state,
    ...(result.death ? { death: result.death } : {}),
  });
}

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
      "agent-game create --user <username> (--seed <name> | --content-file <path> | --world-file <path> | --world '<json>') [--name <gameName>] [--slug <slug>]",
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
      "agent-game player-move --game <gameId|slug> --actor <actorId|actorName> --to <stageId|stageName>",
      "agent-game player-teleport --game <gameId|slug> --actor <actorId|actorName> --to <stageId|stageName>",
      "agent-game player-wait --game <gameId|slug> --actor <actorId|actorName>",
      "agent-game player-strike --game <gameId|slug> --actor <actorId|actorName> --target <actorName>（武器取自 weapon 槽，必须提供 strike）",
      "agent-game player-brawl --game <gameId|slug> --actor <actorId|actorName> --target <actorName>（用身体，不读物品）",
      "agent-game player-steal --game <gameId|slug> --actor <actorId|actorName> --target <actorName> --item <itemName>",
      "agent-game player-give --game <gameId|slug> --actor <actorId|actorName> --target <actorName> --item <itemName>",
      "agent-game player-pickup --game <gameId|slug> --actor <actorId|actorName> --item <itemName>",
      "agent-game player-use --game <gameId|slug> --actor <actorId|actorName> --item <itemName> (--target <actorName> | --stage <stageName>) [--anchor <label>]",
      "agent-game player-equip --game <gameId|slug> --actor <actorId|actorName> --slot <slot> --item <itemName>",
      "agent-game player-unequip --game <gameId|slug> --actor <actorId|actorName> --slot <slot>",
      "agent-game player-remember-identity --game <gameId|slug> --actor <actorId|actorName> --target <actorName> --as <name>（只改自己的记忆，不占行动）",
      "agent-game appearance --game <gameId|slug> (--actor <actorId|actorName> | --all)",
      "agent-game deaths --game <gameId|slug>（对每个 hp 归零且未收尾的 actor 跑一次死亡阶段）",
      "agent-game snapshot --game <gameId|slug> [--root <dir>]",
      "agent-game compact --game <gameId|slug> --owner actor --name <actorId|actorName> [--min-ratio <0..1>]",
      "agent-game compact --game <gameId|slug> --owner stage --name <stageId|stageName> [--min-ratio <0..1>]",
      "agent-game compact --game <gameId|slug> --owner world [--min-ratio <0..1>]",
      "agent-game compact --game <gameId|slug> --owner all [--min-ratio <0..1>]",
      "agent-game story --game <gameId|slug>",
      "agent-game trace list [--game <gameId|slug>] [--since <YYYYMMDD>] [--limit <n>]",
      "agent-game trace show --turn <turnId> [--game <gameId|slug>]",
      "agent-game trace tail [--game <gameId|slug>] [--limit <events>]",
      "agent-game trace stats [--game <gameId|slug>] [--since <YYYYMMDD>]",
      "agent-game trace schema（事件目录与轨迹根目录）",
      "agent-game trace gc --before <YYYYMMDD> [--game <gameId|slug>] [--delete] [--dry-run]（默认压缩归档为 .jsonl.gz）",
      "agent-game trace render (--turn <turnId> | --latest) [--game <gameId|slug>] [--out <path>]（人读视图，可落盘）",
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
  const contentFile = values["content-file"];
  const seedName = values.seed;
  const count = [inline, file, contentFile, seedName].filter(
    (value) => typeof value === "string",
  ).length;
  if (count === 0) {
    throw new Error(
      "create 需要 --seed <name>、--content-file <path>、--world-file <path> 或 --world '<json>' 之一",
    );
  }
  if (count > 1) {
    throw new Error("create 的 --seed、--content-file、--world-file、--world 只能四选一");
  }
  if (typeof seedName === "string") {
    return parseWorldContent(getContentPack(seedName).world);
  }
  if (typeof contentFile === "string") {
    // 内容包同时带来 world 与 knowledge；建局只用 world，knowledge 走 rag ingest --file。
    return (await readContentPackFile(contentFile)).world;
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
      createGame(
        db,
        {
          username,
          ...(typeof values.name === "string" ? { name: values.name } : {}),
          ...(typeof values.slug === "string" ? { slug: values.slug } : {}),
          world,
        },
        { logger: cliLogger },
      ),
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
            targetActorRef: target,
            ...(reason !== undefined ? { reason } : {}),
          })
        : playerWhisper(db, game, actor, {
            message,
            targetActorRef: target,
            ...(reason !== undefined ? { reason } : {}),
          }),
    );
    emitTurn(command, result);
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
    emitTurn(command, result);
    return;
  }

  if (command === "player-move") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.to !== "string" || values.to.trim().length === 0) {
      throw new Error("player-move 需要 --to <stageId|stageName>");
    }
    const result = await withDatabase((db) =>
      playerMove(db, game, actor, { targetStageRef: values.to as string }),
    );
    emitTurn(command, result);
    return;
  }

  if (command === "player-teleport") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.to !== "string" || values.to.trim().length === 0) {
      throw new Error("player-teleport 需要 --to <stageId|stageName>");
    }
    const result = await withDatabase((db) =>
      playerTeleport(db, game, actor, { targetStageRef: values.to as string }),
    );
    emitTurn(command, result);
    return;
  }

  if (command === "player-wait") {
    const { game, actor } = requireActorArgs(values, command);
    const result = await withDatabase((db) => playerWait(db, game, actor));
    emitTurn(command, result);
    return;
  }

  if (command === "player-strike") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.target !== "string" || values.target.trim().length === 0) {
      throw new Error("player-strike 需要 --target <actorName>");
    }
    const result = await withDatabase((db) =>
      playerStrike(
        db,
        game,
        actor,
        { targetActorRef: values.target as string },
        { service: DEEPSEEK_SERVICE, appearanceService: DEEPSEEK_SERVICE },
      ),
    );
    emitTurn(command, result);
    return;
  }

  if (command === "player-brawl") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.target !== "string" || values.target.trim().length === 0) {
      throw new Error("player-brawl 需要 --target <actorName>");
    }
    const result = await withDatabase((db) =>
      playerBrawl(
        db,
        game,
        actor,
        { targetActorRef: values.target as string },
        { appearanceService: DEEPSEEK_SERVICE },
      ),
    );
    emitTurn(command, result);
    return;
  }

  if (command === "player-steal" || command === "player-give") {
    const { game, actor, target, item } = requireTargetItemArgs(values, command);
    const result = await withDatabase((db) =>
      command === "player-steal"
        ? playerSteal(db, game, actor, { targetActorRef: target, itemName: item })
        : playerGive(db, game, actor, { targetActorRef: target, itemName: item }),
    );
    emitTurn(command, result);
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
    emitTurn(command, result);
    return;
  }

  if (command === "player-use") {
    const { game, actor } = requireActorArgs(values, command);
    if (typeof values.item !== "string" || values.item.trim().length === 0) {
      throw new Error("player-use 需要 --item <itemName>");
    }
    const targetActorRef = typeof values.target === "string" ? values.target : undefined;
    const targetStageName = typeof values.stage === "string" ? values.stage : undefined;
    const targetAnchor = typeof values.anchor === "string" ? values.anchor : undefined;
    if ((targetActorRef === undefined) === (targetStageName === undefined)) {
      throw new Error("player-use 需要 --target 或 --stage 二选一");
    }
    if (targetAnchor !== undefined && targetStageName === undefined) {
      throw new Error("player-use 的 --anchor 只能与 --stage 一起使用");
    }
    const result = await withDatabase((db) =>
      playerUse(
        db,
        game,
        actor,
        {
          itemName: values.item as string,
          ...(targetActorRef !== undefined ? { targetActorRef } : {}),
          ...(targetStageName !== undefined ? { targetStageName } : {}),
          ...(targetAnchor !== undefined ? { targetAnchor } : {}),
        },
        { service: DEEPSEEK_SERVICE, appearanceService: DEEPSEEK_SERVICE },
      ),
    );
    emitTurn(command, result);
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
    emitTurn(command, result);
    return;
  }

  if (command === "player-unequip") {
    const { game, actor } = requireActorArgs(values, command);
    const result = await withDatabase((db) =>
      playerUnequip(db, game, actor, { slot: requireSlot(values) }),
    );
    emitTurn(command, result);
    return;
  }

  if (command === "player-remember-identity") {
    const { game, actor } = requireActorArgs(values, command);
    const target = typeof values.target === "string" ? values.target.trim() : "";
    const name = typeof values.as === "string" ? values.as.trim() : "";
    if (target.length === 0 || name.length === 0) {
      throw new Error("player-remember-identity 需要 --target <actorName> 与 --as <name>");
    }
    const result = await withDatabase((db) =>
      playerRememberIdentity(db, game, actor, { targetActorRef: target, name }),
    );
    emitTurn(command, result);
    return;
  }

  if (command === "appearance") {
    if (typeof values.game !== "string") {
      throw new Error("appearance 需要 --game <gameId|slug>");
    }
    // --all 是批量维护：活人重推、未收尾的死者收尾、已收尾的尸体跳过。
    // --actor 是单点干预：强制重推，尸体也照推（不会写收尾标记）。
    if (values.all === true) {
      const result = await withDatabase(async (db) => {
        const state = await getGameState(db, values.game as string);
        return refreshAppearances(db, state.game.id, { service: DEEPSEEK_SERVICE });
      });
      emit({ ok: true, action: command, ...result });
      return;
    }
    const actorName = requireActorName(values, "appearance");
    const result = await withDatabase((db) =>
      runAppearanceTurn(db, values.game as string, actorName, {
        service: DEEPSEEK_SERVICE,
      }),
    );
    emit({ ok: result.ok, action: command, actor: actorName, appearance: result.appearance });
    return;
  }

  if (command === "deaths") {
    if (typeof values.game !== "string") {
      throw new Error("deaths 需要 --game");
    }
    const result = await withDatabase(async (db) => {
      const state = await getGameState(db, values.game as string);
      return settleDeaths(db, state.game.id, { service: DEEPSEEK_SERVICE });
    });
    // 外观失败按设计可以不管，所以 ok 只看死亡是否宣布成功。
    emit({ ok: true, action: command, ...result });
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
        return [
          await runNpcTurn(db, gameRef, actorRef, {
            service: DEEPSEEK_SERVICE,
            appearanceService: DEEPSEEK_SERVICE,
          }),
        ];
      }
      const state = await getGameState(db, gameRef);
      const controlled = new Set(await listPlayerControlledActorIds(db, state.game.id));
      const actorIds = state.world.stages
        .flatMap((stage) => stage.actors.filter(isAlive).map((actor) => actor.id))
        .filter((actorId) => !controlled.has(actorId));
      const output = [];
      for (const actorId of actorIds) {
        output.push(
          await runNpcTurn(db, gameRef, actorId, {
            service: DEEPSEEK_SERVICE,
            appearanceService: DEEPSEEK_SERVICE,
            logger: cliLogger,
          }),
        );
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
        ...(result.death ? { death: result.death } : {}),
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

  if (command === "trace") {
    const sub = parsed.positionals[1] ?? "list";
    const gameSlug = typeof values.game === "string" ? values.game : undefined;
    const since = typeof values.since === "string" ? values.since : undefined;
    const limit =
      typeof values.limit === "string" && values.limit.trim().length > 0
        ? Number(values.limit)
        : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new Error("--limit 必须是正整数");
    }

    if (sub === "list") {
      const turns = await listTurns({
        ...(gameSlug ? { gameSlug } : {}),
        ...(since ? { since } : {}),
        ...(limit ? { limit } : {}),
      });
      emit({ ok: true, action: "trace", sub, turns });
      return;
    }

    if (sub === "show") {
      if (typeof values.turn !== "string" || values.turn.trim().length === 0) {
        throw new Error("trace show 需要 --turn <turnId>");
      }
      const events = await readTurn(values.turn, gameSlug ? { gameSlug } : {});
      emit({ ok: events.length > 0, action: "trace", sub, turnId: values.turn, events });
      return;
    }

    if (sub === "tail") {
      const events = await tailEvents({
        ...(gameSlug ? { gameSlug } : {}),
        ...(since ? { since } : {}),
        limit: limit ?? 40,
      });
      emit({ ok: true, action: "trace", sub, events });
      return;
    }

    if (sub === "stats") {
      const stats = await traceStats({
        ...(gameSlug ? { gameSlug } : {}),
        ...(since ? { since } : {}),
      });
      emit({ ok: true, action: "trace", sub, stats });
      return;
    }

    if (sub === "render") {
      let turnId = typeof values.turn === "string" ? values.turn.trim() : "";
      if (turnId.length === 0) {
        if (values.latest !== true) {
          throw new Error("trace render 需要 --turn <turnId> 或 --latest");
        }
        const turns = await listTurns({ ...(gameSlug ? { gameSlug } : {}), limit: 1 });
        const last = turns.at(-1);
        if (!last) {
          throw new Error("没有可渲染的回合");
        }
        turnId = last.turnId;
      }
      const events = await readTurn(turnId, gameSlug ? { gameSlug } : {});
      if (events.length === 0) {
        throw new Error(`找不到回合: ${turnId}`);
      }
      const text = renderTurnText(events);
      const out = typeof values.out === "string" ? values.out.trim() : "";
      const target = out.length > 0 ? resolve(out) : undefined;
      if (target) {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, text, "utf8");
      }
      emit({
        ok: true,
        action: "trace",
        sub,
        turnId,
        ...(target ? { path: target } : {}),
        text,
      });
      return;
    }

    if (sub === "gc") {
      const before = typeof values.before === "string" ? values.before.trim() : "";
      if (!/^\d{8}$/.test(before)) {
        throw new Error("trace gc 需要 --before <YYYYMMDD>");
      }
      const result = await gcTrace({
        before,
        ...(gameSlug ? { gameSlug } : {}),
        ...(values.delete === true ? { delete: true } : {}),
        ...(values["dry-run"] === true ? { dryRun: true } : {}),
      });
      emit({
        ok: true,
        action: "trace",
        sub,
        before,
        dryRun: values["dry-run"] === true,
        ...result,
      });
      return;
    }

    if (sub === "schema") {
      emit({ ok: true, action: "trace", sub, schema: traceSchema() });
      return;
    }

    throw new Error(`未知 trace 子命令: ${sub}`);
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
