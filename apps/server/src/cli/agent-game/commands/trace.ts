/**
 * 轨迹子系统：`trace list|show|tail|stats|render|gc|schema`。
 *
 * 轨迹是 `logs/` 下的按局按天事件流，不读数据库；字段以 `trace schema` 为准，
 * 这里只做参数解析与输出，排序/归档语义都在 `debug/trace.ts`。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import {
  gcTrace,
  listTurns,
  readTurn,
  renderTurnFiles,
  renderTurnText,
  tailEvents,
  traceSchema,
  traceStats,
} from "../../../debug/trace";
import { optionalOption, positiveIntArg, requiredOption } from "../args";
import { addCommand } from "../command";
import type { CommandContext } from "../context";
import { describeFailure } from "../errors";
import { emit } from "../io";

const ACTION = "trace";
const GROUP = "轨迹";
const TAIL_DEFAULT_LIMIT = 40;

const listInput = z.object({
  game: z.string().trim().min(1).optional(),
  since: z.string().trim().min(1).optional(),
  limit: positiveIntArg("--limit").optional(),
});

const showInput = z.object({
  game: z.string().trim().min(1).optional(),
  turn: requiredValue("--turn <turnId>"),
});

const renderInput = z
  .object({
    game: z.string().trim().min(1).optional(),
    turn: z.string().trim().min(1).optional(),
    latest: z.boolean().default(false),
    out: z.string().trim().min(1).optional(),
  })
  .refine((input) => input.turn !== undefined || input.latest, {
    message: "trace render 需要 --turn <turnId> 或 --latest",
  });

const gcInput = z.object({
  game: z.string().trim().min(1).optional(),
  before: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "trace gc 需要 --before <YYYYMMDD>"),
  delete: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

function requiredValue(label: string) {
  return z.string().trim().min(1, `需要 ${label}`);
}

type ListInput = z.infer<typeof listInput>;

/**
 * `trace list` 也是 `trace` 无子命令时的默认动作，所以单独抽出来给两处复用。
 */
async function runList(input: ListInput): Promise<Record<string, unknown>> {
  const turns = await listTurns({
    ...(input.game === undefined ? {} : { gameSlug: input.game }),
    ...(input.since === undefined ? {} : { since: input.since }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  return { sub: "list", turns };
}

function gameFilter(game: string | undefined): { gameSlug?: string } {
  return game === undefined ? {} : { gameSlug: game };
}

async function runRender(input: z.infer<typeof renderInput>): Promise<Record<string, unknown>> {
  let turnId = input.turn;
  if (turnId === undefined) {
    const turns = await listTurns({ ...gameFilter(input.game), limit: 1 });
    const last = turns.at(-1);
    if (last === undefined) {
      throw new Error("没有可渲染的回合");
    }
    turnId = last.turnId;
  }
  const events = await readTurn(turnId, gameFilter(input.game));
  if (events.length === 0) {
    throw new Error(`找不到回合: ${turnId}`);
  }
  const text = renderTurnText(events);
  if (input.out === undefined) {
    return { sub: "render", turnId, text };
  }
  const target = resolve(input.out);
  // 目录：每轮 request/response 一个文件；.md：合并视图。
  if (target.endsWith(".md")) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
    return { sub: "render", turnId, path: target, text };
  }
  const written: string[] = [];
  await mkdir(target, { recursive: true });
  for (const file of renderTurnFiles(events)) {
    const filePath = join(target, file.name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.text, "utf8");
    written.push(filePath);
  }
  return { sub: "render", turnId, path: target, files: written };
}

export function registerTraceCommands(program: Command, ctx: CommandContext): void {
  const trace = program
    .command("trace")
    .description("轨迹：列举、回读、统计、渲染与归档")
    .helpGroup(GROUP);

  trace.action(async () => {
    try {
      emit({ ok: true, action: ACTION, ...(await runList({})) });
    } catch (error) {
      throw describeFailure(error, ACTION);
    }
  });

  addCommand(trace, ctx, {
    name: "list",
    action: ACTION,
    summary: "列出回合（默认子命令）",
    options: [
      optionalOption("--game <ref>", "gameId 或 slug"),
      optionalOption("--since <YYYYMMDD>", "起始日期"),
      optionalOption("--limit <n>", "最多返回多少回合"),
    ],
    schema: listInput,
    run: (input) => runList(input),
  });

  addCommand(trace, ctx, {
    name: "show",
    action: ACTION,
    summary: "回读一个回合的全部事件",
    options: [
      requiredOption("--turn <turnId>", "回合 id"),
      optionalOption("--game <ref>", "gameId 或 slug"),
    ],
    schema: showInput,
    run: async (input) => {
      const events = await readTurn(input.turn, gameFilter(input.game));
      if (events.length === 0) {
        throw new Error(`找不到回合: ${input.turn}`);
      }
      return { sub: "show", turnId: input.turn, events };
    },
  });

  addCommand(trace, ctx, {
    name: "tail",
    action: ACTION,
    summary: "看最近的事件流",
    options: [
      optionalOption("--game <ref>", "gameId 或 slug"),
      optionalOption("--since <YYYYMMDD>", "起始日期"),
      optionalOption("--limit <n>", `条数，默认 ${TAIL_DEFAULT_LIMIT}`),
    ],
    schema: listInput,
    run: async (input) => ({
      sub: "tail",
      events: await tailEvents({
        ...gameFilter(input.game),
        ...(input.since === undefined ? {} : { since: input.since }),
        limit: input.limit ?? TAIL_DEFAULT_LIMIT,
      }),
    }),
  });

  addCommand(trace, ctx, {
    name: "stats",
    action: ACTION,
    summary: "按天统计事件量",
    options: [
      optionalOption("--game <ref>", "gameId 或 slug"),
      optionalOption("--since <YYYYMMDD>", "起始日期"),
    ],
    schema: listInput,
    run: async (input) => ({
      sub: "stats",
      stats: await traceStats({
        ...gameFilter(input.game),
        ...(input.since === undefined ? {} : { since: input.since }),
      }),
    }),
  });

  addCommand(trace, ctx, {
    name: "render",
    action: ACTION,
    summary: "把回合渲染成 Markdown（目录或单文件）",
    options: [
      optionalOption("--turn <turnId>", "回合 id"),
      optionalOption("--latest", "渲染最近一个回合"),
      optionalOption("--game <ref>", "gameId 或 slug"),
      optionalOption("--out <path>", "输出目录或 .md 路径"),
    ],
    schema: renderInput,
    run: (input) => runRender(input),
  });

  addCommand(trace, ctx, {
    name: "gc",
    action: ACTION,
    summary: "归档或删除早于某天的轨迹",
    options: [
      requiredOption("--before <YYYYMMDD>", "早于这一天的轨迹"),
      optionalOption("--game <ref>", "gameId 或 slug"),
      optionalOption("--delete", "直接删除而不是压缩归档"),
      optionalOption("--dry-run", "只报告会动到哪些文件"),
    ],
    schema: gcInput,
    run: async (input) => ({
      sub: "gc",
      before: input.before,
      dryRun: input.dryRun,
      ...(await gcTrace({
        before: input.before,
        ...gameFilter(input.game),
        ...(input.delete ? { delete: true } : {}),
        ...(input.dryRun ? { dryRun: true } : {}),
      })),
    }),
  });

  addCommand(trace, ctx, {
    name: "schema",
    action: ACTION,
    summary: "打印事件目录与轨迹根目录",
    schema: z.object({}),
    run: () => Promise.resolve({ sub: "schema", schema: traceSchema() }),
  });
}
