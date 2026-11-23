/**
 * 建局与读取：与 `agent-game` 同名同参数，执行体换成 HTTP。
 *
 * `--content-file` / `--world-file` 在本地读取后内联成 `world` 发给服务端：
 * 服务端不读调用方的文件系统。
 */

import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { z } from "zod";
import { gameOption, optionalOption, positiveIntArg } from "../../args";
import { UsageError } from "../../errors";
import { addApiCommand } from "../command";

const GROUP = "建局与读取";

const createInput = z.object({
  seed: z.string().trim().min(1).optional(),
  contentFile: z.string().trim().min(1).optional(),
  worldFile: z.string().trim().min(1).optional(),
  world: z.string().optional(),
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).optional(),
});

type CreateInput = z.infer<typeof createInput>;

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new UsageError(`${label} 读取或解析失败: ${path}（${String(error)}）`);
  }
}

/** 内容来源四选一；内容包只取 `world`，knowledge 用 `agent:game` 的命令灌库。 */
async function createBody(input: CreateInput): Promise<Record<string, unknown>> {
  const sources = [input.seed, input.contentFile, input.worldFile, input.world].filter(
    (value) => value !== undefined,
  );
  if (sources.length === 0) {
    throw new UsageError("create 需要 --seed、--content-file、--world-file 或 --world 之一");
  }
  if (sources.length > 1) {
    throw new UsageError("create 的 --seed、--content-file、--world-file、--world 只能四选一");
  }
  if (input.contentFile !== undefined) {
    const pack = (await readJson(input.contentFile, "--content-file")) as {
      world?: unknown;
    };
    if (pack.world === undefined) {
      throw new UsageError("--content-file 缺少 world");
    }
    return {
      world: pack.world,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
    };
  }
  if (input.worldFile !== undefined) {
    return {
      world: await readJson(input.worldFile, "--world-file"),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
    };
  }
  if (input.world !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.world);
    } catch {
      throw new UsageError("--world 不是合法 JSON");
    }
    return {
      world: parsed,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
    };
  }
  return {
    seed: input.seed,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.slug === undefined ? {} : { slug: input.slug }),
  };
}

export function registerGameCommands(program: Command): void {
  addApiCommand(program, {
    name: "create",
    group: GROUP,
    summary: "用种子 / world JSON 建一局",
    options: [
      optionalOption("--seed <name>", "内置内容包名；先跑 content-packs 看可用值"),
      optionalOption("--content-file <path>", "内容包 JSON（取其中的 world）"),
      optionalOption("--world-file <path>", "只含 world 的 JSON 文件"),
      optionalOption("--world <json>", "内联 world JSON"),
      optionalOption("--name <gameName>", "局名"),
      optionalOption("--slug <slug>", "局 slug"),
    ],
    schema: createInput,
    run: async (input, client) => {
      const body = await createBody(input);
      const created = (await client.call({ method: "POST", path: "/games", body })) as {
        view?: { game?: { slug?: string } };
      };
      const slug = created.view?.game?.slug;
      if (slug === undefined) {
        throw new Error("建局响应缺少 view.game.slug");
      }
      // 建局返回客户端投影；同一命令要与 agent-game 输出同样的 `{ state }`，所以再读一次控制面。
      return (await client.call({
        method: "GET",
        path: `/games/${encodeURIComponent(slug)}/state`,
      })) as Record<string, unknown>;
    },
  });

  addApiCommand(program, {
    name: "content-packs",
    group: GROUP,
    summary: "列出服务端可用的内置内容包",
    schema: z.object({}),
    run: async (_input, client) =>
      (await client.call({ method: "GET", path: "/games/content-packs" })) as Record<
        string,
        unknown
      >,
  });

  addApiCommand(program, {
    name: "status",
    group: GROUP,
    summary: "读取一局的完整状态",
    options: [gameOption()],
    schema: z.object({ game: z.string() }),
    run: async (input, client) =>
      (await client.call({
        method: "GET",
        path: `/games/${encodeURIComponent(input.game)}/state`,
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "view",
    group: GROUP,
    summary: "读取一局的观看者投影（默认玩家操控的角色）",
    options: [gameOption(), optionalOption("--actor <ref>", "换一个观看者，默认主角")],
    schema: z.object({ game: z.string(), actor: z.string().trim().min(1).optional() }),
    run: async (input, client) =>
      (await client.call({
        method: "GET",
        path: `/games/${encodeURIComponent(input.game)}`,
        query: { actor: input.actor },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "messages",
    group: GROUP,
    summary: "按序号增量读公共事件流",
    options: [
      gameOption(),
      optionalOption("--after <sequence>", "只读序号大于它的消息，默认从头"),
      optionalOption("--limit <count>", "单次条数上限"),
    ],
    schema: z.object({
      game: z.string(),
      after: z.coerce.number().int().min(0).optional(),
      limit: positiveIntArg("--limit").optional(),
    }),
    run: async (input, client) =>
      (await client.call({
        method: "GET",
        path: `/games/${encodeURIComponent(input.game)}/messages`,
        query: { after: input.after, limit: input.limit },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "stage-map",
    group: GROUP,
    summary: "按舞台列出 actor 名字",
    options: [gameOption()],
    schema: z.object({ game: z.string() }),
    run: async (input, client) =>
      (await client.call({
        method: "GET",
        path: `/games/${encodeURIComponent(input.game)}/stage-map`,
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "snapshot",
    group: GROUP,
    summary: "把当前局落成服务端文件快照",
    options: [gameOption(), optionalOption("--root <dir>", "快照根目录，默认服务端仓库 logs 下")],
    schema: z.object({ game: z.string(), root: z.string().trim().min(1).optional() }),
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/snapshot`,
        body: input.root === undefined ? {} : { root: input.root },
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "story",
    group: GROUP,
    summary: "跑一次故事总结并落盘",
    options: [gameOption()],
    schema: z.object({ game: z.string() }),
    run: async (input, client) =>
      (await client.call({
        method: "POST",
        path: `/games/${encodeURIComponent(input.game)}/story`,
        body: {},
      })) as Record<string, unknown>,
  });

  addApiCommand(program, {
    name: "me",
    group: GROUP,
    summary: "当前身份（开发期令牌解析出的用户）",
    schema: z.object({}),
    run: async (_input, client) =>
      (await client.call({ method: "GET", path: "/me" })) as Record<string, unknown>,
  });
}
