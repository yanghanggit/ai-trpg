/**
 * 建局与读状态：`create` / `status` / `scene-map` / `snapshot` / `story`。
 *
 * 读命令不调用 LLM、不改状态；`create` 必须显式给出内容来源，不做隐式默认。
 */

import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { z } from "zod";
import { CONTENT_PACKS, getContentPack } from "../../../../seeds";
import { readContentPackFile } from "../../../content-pack";
import { dumpStory } from "../../../debug/story-dump";
import { DEEPSEEK_SERVICE } from "../../../deepseek";
import { createGame, getGameState, runStory, snapshotGame } from "../../../game";
import type { World } from "../../../game/types";
import { parseWorldContent } from "../../../game/world-content";
import { gameOption, optionalOption, requiredOption } from "../args";
import { addCommand } from "../command";
import type { CommandContext } from "../context";
import { UsageError } from "../errors";

const GROUP = "建局与读取";

const createInput = z.object({
  user: z.string().trim().min(1, "需要 --user <username>"),
  seed: z.string().trim().min(1).optional(),
  contentFile: z.string().trim().min(1).optional(),
  worldFile: z.string().trim().min(1).optional(),
  world: z.string().optional(),
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
});

type CreateInput = z.infer<typeof createInput>;

function parseJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new UsageError(`${source} 不是合法 JSON`);
  }
}

/**
 * 内容来源四选一：种子、内容包、world 文件、内联 world。
 *
 * 内容包同时带来 world 与 knowledge；建局只用 world，knowledge 走 `rag ingest --file`。
 */
async function loadCreateWorld(input: CreateInput): Promise<World> {
  const sources = [input.seed, input.contentFile, input.worldFile, input.world].filter(
    (value) => value !== undefined,
  );
  if (sources.length === 0) {
    throw new UsageError("create 需要 --seed、--content-file、--world-file 或 --world 之一");
  }
  if (sources.length > 1) {
    throw new UsageError("create 的 --seed、--content-file、--world-file、--world 只能四选一");
  }
  if (input.seed !== undefined) {
    return parseWorldContent(getContentPack(input.seed).world);
  }
  if (input.contentFile !== undefined) {
    return (await readContentPackFile(input.contentFile)).world;
  }
  const raw =
    input.worldFile !== undefined
      ? parseJson(await readFile(input.worldFile, "utf8"), `--world-file ${input.worldFile}`)
      : parseJson(input.world ?? "", "--world");
  return parseWorldContent(raw);
}

export function registerGameCommands(program: Command, ctx: CommandContext): void {
  addCommand(program, ctx, {
    name: "create",
    group: GROUP,
    summary: "用种子 / 内容包 / world JSON 建一局",
    options: [
      requiredOption("--user <username>", "局主用户名"),
      optionalOption("--seed <name>", `内置内容包：${Object.keys(CONTENT_PACKS).join(" / ")}`),
      optionalOption("--content-file <path>", "内容包 JSON（含 world 与 knowledge）"),
      optionalOption("--world-file <path>", "只含 world 的 JSON 文件"),
      optionalOption("--world <json>", "内联 world JSON"),
      optionalOption("--name <gameName>", "局名"),
      optionalOption("--slug <slug>", "局 slug"),
    ],
    schema: createInput,
    run: async (input, ctx) => {
      const world = await loadCreateWorld(input);
      const state = await ctx.db((db) =>
        createGame(
          db,
          {
            username: input.user,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            world,
          },
          { logger: ctx.log() },
        ),
      );
      return { state };
    },
  });

  addCommand(program, ctx, {
    name: "status",
    group: GROUP,
    summary: "读取一局的完整状态",
    options: [gameOption()],
    schema: z.object({ game: z.string() }),
    run: async (input, ctx) => ({ state: await ctx.db((db) => getGameState(db, input.game)) }),
  });

  addCommand(program, ctx, {
    name: "scene-map",
    group: GROUP,
    summary: "按场景列出 actor 名字",
    options: [gameOption()],
    schema: z.object({ game: z.string() }),
    run: async (input, ctx) => {
      const state = await ctx.db((db) => getGameState(db, input.game));
      const scenes = Object.fromEntries(
        state.world.stages.map((stage) => [stage.name, stage.actors.map((actor) => actor.name)]),
      );
      return { scenes };
    },
  });

  addCommand(program, ctx, {
    name: "snapshot",
    group: GROUP,
    summary: "把当前局落成文件快照",
    options: [gameOption(), optionalOption("--root <dir>", "快照根目录，默认仓库 logs 下")],
    schema: z.object({ game: z.string(), root: z.string().trim().min(1).optional() }),
    run: async (input, ctx) => {
      const result = await ctx.db((db) =>
        snapshotGame(db, input.game, { root: input.root, action: "snapshot" }),
      );
      return {
        path: result.snapshot.path,
        manifest: result.snapshot.manifest,
        game: result.state.game,
      };
    },
  });

  addCommand(program, ctx, {
    name: "story",
    group: GROUP,
    summary: "跑一次故事总结并落盘",
    options: [gameOption()],
    schema: z.object({ game: z.string() }),
    run: async (input, ctx) => {
      const result = await ctx.db((db) => runStory(db, input.game, { service: DEEPSEEK_SERVICE }));
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
    },
  });
}
