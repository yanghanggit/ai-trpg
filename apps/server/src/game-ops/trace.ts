/**
 * 过程轨迹的读取与渲染：一份编排，供 CLI 与 HTTP 共用。
 *
 * 轨迹是文件语料，不读数据库；这里只负责「读哪些、按什么顺序、输出什么形状」。
 * 写文件（render 的 `--out`）跟随调用方进程，所以渲染落在 ops、落盘位置由调用方给。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  gcTrace,
  listTurns,
  readTurn,
  renderTurnFiles,
  renderTurnText,
  type TraceLine,
  type TraceStats,
  type TraceTurnSummary,
  tailEvents,
  traceSchema,
  traceStats,
} from "../debug/trace";

const TAIL_DEFAULT_LIMIT = 40;

export type TraceQuery = {
  game?: string;
  since?: string;
  limit?: number;
};

/** 轨迹查询只认 `gameSlug`；这里把 CLI / HTTP 的 `game` 引用翻译过去。 */
function queryOf(input: TraceQuery): {
  gameSlug?: string;
  since?: string;
  limit?: number;
} {
  return {
    ...(input.game === undefined ? {} : { gameSlug: input.game }),
    ...(input.since === undefined ? {} : { since: input.since }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

export async function listTurnsOp(input: TraceQuery = {}): Promise<{ turns: TraceTurnSummary[] }> {
  return { turns: await listTurns(queryOf(input)) };
}

export async function readTurnOp(
  turnId: string,
  input: TraceQuery = {},
): Promise<{ turnId: string; events: TraceLine[] }> {
  const events = await readTurn(turnId, queryOf(input));
  if (events.length === 0) {
    throw new Error(`找不到回合: ${turnId}`);
  }
  return { turnId, events };
}

export async function tailEventsOp(input: TraceQuery = {}): Promise<{ events: TraceLine[] }> {
  return {
    events: await tailEvents({
      ...queryOf(input),
      limit: input.limit ?? TAIL_DEFAULT_LIMIT,
    }),
  };
}

export async function traceStatsOp(input: TraceQuery = {}): Promise<{ stats: TraceStats }> {
  return { stats: await traceStats(queryOf(input)) };
}

export function traceSchemaOp(): { schema: ReturnType<typeof traceSchema> } {
  return { schema: traceSchema() };
}

export type RenderTurnInput = TraceQuery & {
  turn?: string;
  latest?: boolean;
  out?: string;
};

/**
 * 渲染一个回合：不传 `turn` 时取最近的那个回合。
 *
 * `out` 是 `.md` 就合并成一份，否则按轮次的请求 / 响应各写一份；不传则只回文本。
 */
export async function renderTurnOp(input: RenderTurnInput = {}): Promise<{
  turnId: string;
  text?: string;
  path?: string;
  files?: string[];
}> {
  let turnId = input.turn;
  if (turnId === undefined) {
    const { turns } = await listTurnsOp({ ...input, limit: 1 });
    const last = turns.at(-1);
    if (last === undefined) {
      throw new Error("没有可渲染的回合");
    }
    turnId = last.turnId;
  }
  const { events } = await readTurnOp(turnId, input);
  const text = renderTurnText(events);
  if (input.out === undefined) {
    return { turnId, text };
  }
  const target = resolve(input.out);
  if (target.endsWith(".md")) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
    return { turnId, path: target, text };
  }
  const written: string[] = [];
  await mkdir(target, { recursive: true });
  for (const file of renderTurnFiles(events)) {
    const filePath = join(target, file.name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.text, "utf8");
    written.push(filePath);
  }
  return { turnId, path: target, files: written };
}

export type TraceGcInput = {
  game?: string;
  before: string;
  delete?: boolean;
  dryRun?: boolean;
};

export async function gcTraceOp(
  input: TraceGcInput,
): Promise<{ before: string; dryRun: boolean } & Awaited<ReturnType<typeof gcTrace>>> {
  const result = await gcTrace({
    before: input.before,
    ...(input.game === undefined ? {} : { gameSlug: input.game }),
    ...(input.delete ? { delete: true } : {}),
    ...(input.dryRun ? { dryRun: true } : {}),
  });
  return { before: input.before, dryRun: input.dryRun === true, ...result };
}
