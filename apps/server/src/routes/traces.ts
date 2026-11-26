/**
 * 轨迹的只读 API：列举、回读、tail、统计。
 *
 * 轨迹是服务端 `logs/` 下的追加事件流，不读数据库；这里的路由只做文件读取，
 * 不参与任何游戏判定。渲染与归档是本地文件操作，留在 `agent:game` / `agent:api`。
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../db/pool";
import {
  listTraceFiles,
  listTurns,
  readTurn,
  tailEvents,
  traceSchema,
  traceStats,
} from "../debug/trace";
import { requireAdmin } from "../plugins/auth";

const TAIL_DEFAULT_LIMIT = 40;

const gameParams = z.object({ game: z.string().trim().min(1) });
const limitQuery = z.object({
  since: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "since 需要 YYYYMMDD")
    .optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

/** 阅览器的目录清单：只有元数据，不含任何一行事件。 */
const traceFileSchema = z.object({
  name: z.string(),
  day: z.string(),
  bytes: z.number(),
  modifiedAt: z.iso.datetime(),
});

const traceGameSchema = z.object({
  slug: z.string(),
  files: z.array(traceFileSchema),
  bytes: z.number(),
  lastAt: z.iso.datetime().nullable(),
});

export function createTraceRoutes(db: () => Database): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/traces",
      {
        schema: {
          tags: ["traces"],
          summary: "列出回合（可跨局）",
          querystring: limitQuery.extend({ game: z.string().trim().min(1).optional() }),
          response: {
            200: z.object({ turns: z.array(z.record(z.string(), z.unknown())) }),
          },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async (request) => {
        const { game, since, limit } = request.query;
        return {
          turns: await listTurns({
            ...(game === undefined ? {} : { gameSlug: game }),
            ...(since === undefined ? {} : { since }),
            ...(limit === undefined ? {} : { limit }),
          }),
        };
      },
    );

    app.get(
      "/traces/files",
      {
        schema: {
          tags: ["traces"],
          summary: "轨迹目录清单（阅览器的左侧栏）",
          response: {
            200: z.object({ dir: z.string(), games: z.array(traceGameSchema) }),
          },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async () => listTraceFiles(),
    );

    app.get(
      "/traces/stats",
      {
        schema: {
          tags: ["traces"],
          summary: "跨回合聚合统计",
          querystring: limitQuery.extend({ game: z.string().trim().min(1).optional() }),
          response: { 200: z.object({ stats: z.record(z.string(), z.unknown()) }) },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async (request) => {
        const { game, since } = request.query;
        return {
          stats: await traceStats({
            ...(game === undefined ? {} : { gameSlug: game }),
            ...(since === undefined ? {} : { since }),
          }),
        };
      },
    );

    app.get(
      "/traces/schema",
      {
        schema: {
          tags: ["traces"],
          summary: "事件目录与轨迹根目录",
          response: { 200: z.record(z.string(), z.unknown()) },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async () => traceSchema(),
    );

    app.get(
      "/traces/tail",
      {
        schema: {
          tags: ["traces"],
          summary: "最近的事件流（可跨局）",
          querystring: limitQuery.extend({ game: z.string().trim().min(1).optional() }),
          response: { 200: z.object({ events: z.array(z.record(z.string(), z.unknown())) }) },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async (request) => {
        const { game, since, limit } = request.query;
        return {
          events: await tailEvents({
            limit: limit ?? TAIL_DEFAULT_LIMIT,
            ...(game === undefined ? {} : { gameSlug: game }),
            ...(since === undefined ? {} : { since }),
          }),
        };
      },
    );

    app.get(
      "/traces/:turn",
      {
        schema: {
          tags: ["traces"],
          summary: "按 turnId 回读一个回合（跨局）",
          params: z.object({ turn: z.string().trim().min(1) }),
          response: { 200: z.object({ events: z.array(z.record(z.string(), z.unknown())) }) },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async (request) => ({ events: await readTurn(request.params.turn) }),
    );

    app.get(
      "/games/:game/traces",
      {
        schema: {
          tags: ["traces"],
          summary: "列举某一局的回合",
          params: gameParams,
          querystring: limitQuery,
          response: { 200: z.object({ turns: z.array(z.record(z.string(), z.unknown())) }) },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async (request) => ({
        turns: await listTurns({
          gameSlug: request.params.game,
          ...(request.query.since === undefined ? {} : { since: request.query.since }),
          ...(request.query.limit === undefined ? {} : { limit: request.query.limit }),
        }),
      }),
    );

    app.get(
      "/games/:game/traces/tail",
      {
        schema: {
          tags: ["traces"],
          summary: "看最近的事件流",
          params: gameParams,
          querystring: limitQuery,
          response: { 200: z.object({ events: z.array(z.record(z.string(), z.unknown())) }) },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async (request) => ({
        events: await tailEvents({
          gameSlug: request.params.game,
          limit: request.query.limit ?? TAIL_DEFAULT_LIMIT,
          ...(request.query.since === undefined ? {} : { since: request.query.since }),
        }),
      }),
    );

    app.get(
      "/games/:game/traces/:turn",
      {
        schema: {
          tags: ["traces"],
          summary: "回读一个回合的全部事件",
          params: gameParams.extend({ turn: z.string().trim().min(1) }),
          response: { 200: z.object({ events: z.array(z.record(z.string(), z.unknown())) }) },
        },
        preHandler: async (request) => {
          await requireAdmin(db(), request);
        },
      },
      async (request) => ({
        events: await readTurn(request.params.turn, { gameSlug: request.params.game }),
      }),
    );
  };
}
