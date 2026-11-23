/**
 * 轨迹子系统：与 `agent-game trace` 的读命令对齐，走服务端的 `logs/` 读取。
 *
 * 渲染在本地完成（服务端只回事件），归档 `gc` 是调用方机器上的文件操作，
 * 因此不经 HTTP。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import { z } from "zod";
import { gcTrace, renderTurnFiles, renderTurnText, type TraceLine } from "../../../debug/trace";
import { optionalOption, positiveIntArg, requiredOption } from "../../args";
import { CliFailure, describeFailure } from "../../errors";
import { emit } from "../../io";
import { createApiClient, type GlobalFlags } from "../client";
import { addApiCommand } from "../command";

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

const tailInput = z.object({
  game: z.string().trim().min(1).optional(),
  since: z.string().trim().min(1).optional(),
  limit: positiveIntArg("--limit").optional(),
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

function eventsOf(payload: unknown): TraceLine[] {
  const record =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const events = record.events;
  if (!Array.isArray(events)) {
    throw new CliFailure("响应缺少 events", ACTION, 1);
  }
  return events as TraceLine[];
}

export function registerTraceCommands(program: Command): void {
  const trace = program
    .command("trace")
    .description("轨迹：列举、回读、统计、渲染与归档")
    .helpGroup(GROUP);

  trace.action(async (_options, cmd: Command) => {
    try {
      const client = createApiClient(cmd.optsWithGlobals<GlobalFlags>());
      const turns = (await client.call({ method: "GET", path: "/traces" })) as Record<
        string,
        unknown
      >;
      emit({ ok: true, action: ACTION, sub: "list", ...turns });
    } catch (error) {
      throw describeFailure(error, ACTION);
    }
  });

  addApiCommand(trace, {
    name: "list",
    action: ACTION,
    summary: "列出回合（默认子命令）",
    options: [
      optionalOption("--game <ref>", "只读这一局"),
      optionalOption("--since <YYYYMMDD>", "只看这天之后"),
      optionalOption("--limit <count>", "最多几轮"),
    ],
    schema: listInput,
    run: async (input, client) => {
      const result = (await client.call({
        method: "GET",
        path: "/traces",
        query: { game: input.game, since: input.since, limit: input.limit },
      })) as Record<string, unknown>;
      return { sub: "list", ...result };
    },
  });

  addApiCommand(trace, {
    name: "show",
    action: ACTION,
    summary: "回读一个回合的全部事件",
    options: [
      optionalOption("--game <ref>", "只读这一局"),
      requiredOption("--turn <turnId>", "回合 id"),
    ],
    schema: showInput,
    run: async (input, client) => {
      const path =
        input.game === undefined
          ? `/traces/${encodeURIComponent(input.turn)}`
          : `/games/${encodeURIComponent(input.game)}/traces/${encodeURIComponent(input.turn)}`;
      const result = (await client.call({ method: "GET", path })) as Record<string, unknown>;
      return { sub: "show", turnId: input.turn, ...result };
    },
  });

  addApiCommand(trace, {
    name: "tail",
    action: ACTION,
    summary: "看最近的事件流",
    options: [
      optionalOption("--game <ref>", "只读这一局"),
      optionalOption("--since <YYYYMMDD>", "只看这天之后"),
      optionalOption("--limit <count>", `最近多少条，默认 ${TAIL_DEFAULT_LIMIT}`),
    ],
    schema: tailInput,
    run: async (input, client) => {
      const result = (await client.call({
        method: "GET",
        path:
          input.game === undefined
            ? "/traces/tail"
            : `/games/${encodeURIComponent(input.game)}/traces/tail`,
        query: { limit: input.limit, since: input.since },
      })) as Record<string, unknown>;
      return { sub: "tail", ...result };
    },
  });

  addApiCommand(trace, {
    name: "stats",
    action: ACTION,
    summary: "按天统计事件量",
    options: [
      optionalOption("--game <ref>", "只读这一局"),
      optionalOption("--since <YYYYMMDD>", "只看这天之后"),
    ],
    schema: z.object({
      game: z.string().trim().min(1).optional(),
      since: z.string().trim().min(1).optional(),
    }),
    run: async (input, client) => {
      const result = (await client.call({
        method: "GET",
        path: "/traces/stats",
        query: { game: input.game, since: input.since },
      })) as Record<string, unknown>;
      return { sub: "stats", ...result };
    },
  });

  addApiCommand(trace, {
    name: "schema",
    action: ACTION,
    summary: "打印事件目录与轨迹根目录",
    schema: z.object({}),
    run: async (_input, client) => {
      const result = (await client.call({ method: "GET", path: "/traces/schema" })) as Record<
        string,
        unknown
      >;
      return { sub: "schema", ...result };
    },
  });

  addApiCommand(trace, {
    name: "render",
    action: ACTION,
    summary: "把回合渲染成 Markdown（目录或单文件）",
    options: [
      optionalOption("--game <ref>", "只读这一局"),
      optionalOption("--turn <turnId>", "回合 id"),
      optionalOption("--latest", "渲染最近一轮"),
      optionalOption("--out <path>", "输出目录或 .md 文件"),
    ],
    schema: renderInput,
    run: async (input, client) => {
      let turnId = input.turn;
      if (turnId === undefined) {
        const listed = (await client.call({
          method: "GET",
          path:
            input.game === undefined
              ? "/traces"
              : `/games/${encodeURIComponent(input.game)}/traces`,
          query: { limit: 1 },
        })) as { turns?: { turnId: string }[] };
        const last = listed.turns?.at(-1);
        if (last === undefined) {
          throw new CliFailure("没有可渲染的回合", ACTION, 1);
        }
        turnId = last.turnId;
      }
      const path =
        input.game === undefined
          ? `/traces/${encodeURIComponent(turnId)}`
          : `/games/${encodeURIComponent(input.game)}/traces/${encodeURIComponent(turnId)}`;
      const events = eventsOf(await client.call({ method: "GET", path }));
      if (events.length === 0) {
        throw new CliFailure(`找不到回合: ${turnId}`, ACTION, 1);
      }
      const text = renderTurnText(events);
      if (input.out === undefined) {
        return { sub: "render", turnId, text };
      }
      const target = resolve(input.out);
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
    },
  });

  addApiCommand(trace, {
    name: "gc",
    action: ACTION,
    summary: "归档或删除早于某天的轨迹（读本地 logs）",
    options: [
      optionalOption("--game <ref>", "只处理这一局"),
      requiredOption("--before <YYYYMMDD>", "早于这天"),
      optionalOption("--delete", "真删而不是归档"),
      optionalOption("--dry-run", "只列出将处理什么"),
    ],
    schema: gcInput,
    run: async (input) => {
      const result = await gcTrace({
        ...(input.game === undefined ? {} : { gameSlug: input.game }),
        before: input.before,
        delete: input.delete,
        dryRun: input.dryRun,
      });
      return { sub: "gc", ...result };
    },
  });
}
