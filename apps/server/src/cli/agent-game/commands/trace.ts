/**
 * 轨迹子系统：`trace list|show|tail|stats|render|gc|schema`。
 *
 * 参数与帮助在这里，读取 / 渲染 / 归档的编排在 `game-ops`；
 * 字段以 `trace schema` 为准，两者都不在本文件复述。
 */

import type { Command } from "commander";
import { z } from "zod";
import {
  gcTraceOp,
  listTurnsOp,
  readTurnOp,
  renderTurnOp,
  tailEventsOp,
  traceSchemaOp,
  traceStatsOp,
} from "../../../game-ops";
import { optionalOption, positiveIntArg, requiredOption } from "../../args";
import { describeFailure } from "../../errors";
import { emit } from "../../io";
import { addCommand } from "../command";
import type { CommandContext } from "../context";

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

export function registerTraceCommands(program: Command, ctx: CommandContext): void {
  const trace = program
    .command("trace")
    .description("轨迹：列举、回读、统计、渲染与归档")
    .helpGroup(GROUP);

  trace.action(async () => {
    try {
      emit({ ok: true, action: ACTION, sub: "list", ...(await listTurnsOp()) });
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
    run: async (input) => ({ sub: "list", ...(await listTurnsOp(input)) }),
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
    run: async (input) => ({ sub: "show", ...(await readTurnOp(input.turn, input)) }),
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
    run: async (input) => ({ sub: "tail", ...(await tailEventsOp(input)) }),
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
    run: async (input) => ({ sub: "stats", ...(await traceStatsOp(input)) }),
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
    run: async (input) => ({ sub: "render", ...(await renderTurnOp(input)) }),
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
    run: async (input) => ({ sub: "gc", ...(await gcTraceOp(input)) }),
  });

  addCommand(trace, ctx, {
    name: "schema",
    action: ACTION,
    summary: "打印事件目录与轨迹根目录",
    schema: z.object({}),
    run: async () => ({ sub: "schema", ...traceSchemaOp() }),
  });
}
