/**
 * 作业状态推送（SSE）：连上先补发，再转实时。
 *
 * 推送不是真相，只是一次「去看一眼」的提醒：每条事件都是那一刻的完整作业视图，
 * 所以重复、乱序、断线重来都无害——客户端按 `updatedAt` 去重、按 `updatedAt` 的游标补查。
 *
 * 三个刻意的取舍：
 *
 * 1. 补发与实时共用一个写入口，按 `updatedAt` 升序落笔；订阅先挂、补发后跑，
 *    补发期间到达的变更排队，不会因为「正好在补发那一刻完成」而丢掉。
 * 2. 订阅源在库里（`LISTEN/NOTIFY`），不是进程内事件：worker 分进程、多 API 实例时仍然成立。
 * 3. 不发送世界状态，只发送作业行。要看世界就回 `view` / `messages` 重读。
 *
 * 由此带来一个必须写进契约的行为：**同一作业的多次变更可能被合并成一条事件**。
 * 推送读的是「那一刻的行」，如果领取、报进度、完成挤在同一毫秒里，客户端只会收到最终态。
 * 事件是快照而不是流水账——要流水账去看过程轨迹（`traces`）。
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../db/pool";
import { findGame } from "../game/persistence/games";
import { listTurnJobs, readTurnJob, type TurnJobView, turnSerializationKey } from "../game-ops";
import { HttpError } from "../http-error";
import type { JobChangeBroker } from "../jobs";
import { requireUser } from "../plugins/auth";
import { requireGameAccess } from "./games";

const gameParams = z.object({ game: z.string().trim().min(1) });

const streamQuery = z.object({
  /** 从这个游标之后补发；不给就只补活跃作业。 */
  since: z.iso.datetime().optional(),
  /** 浏览器的 `EventSource` 不能自带请求头，因此这条流允许把开发期身份放进查询串。 */
  token: z.string().optional(),
});

/** 心跳间隔：代理与浏览器都会掐掉长时间没有字节的连接。 */
const HEARTBEAT_INTERVAL_MS = 15_000;

export function createJobStreamRoutes(
  db: () => Database,
  broker: JobChangeBroker | undefined,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/games/:game/jobs/stream",
      {
        schema: {
          tags: ["jobs"],
          summary: "订阅这一局的作业状态（SSE）",
          description:
            "连上先补发（给了 since 就补发那之后的、含终态；不给就只补活跃作业），再转实时。" +
            "每条事件是那一刻的完整作业视图，`id` 与视图的 updatedAt 相同，可直接当下次重连的 since。" +
            "断线期间的通知会丢，重连补查就是兜底。",
          params: gameParams,
          querystring: streamQuery,
          produces: ["text/event-stream"],
        },
      },
      async (request, reply) => {
        const user = await requireUser(db(), request, { allowQueryToken: true });
        await requireGameAccess(db(), request.params.game, user);
        const game = await findGame(db(), request.params.game);
        if (!game) {
          throw new HttpError(404, "not_found", `游戏不存在: ${request.params.game}`);
        }
        if (broker === undefined) {
          throw new HttpError(503, "unavailable", "作业推送未启用：这个进程没有启动订阅");
        }

        const since = request.query.since === undefined ? undefined : new Date(request.query.since);
        const key = turnSerializationKey(game.id);

        // 先取头部再 hijack：onRequest 阶段挂上的 CORS 头要跟着一起写进去。
        const inherited: Record<string, string | number | string[]> = {};
        for (const [name, value] of Object.entries(reply.getHeaders())) {
          if (typeof value === "string" || typeof value === "number" || Array.isArray(value)) {
            inherited[name] = value;
          }
        }
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
          ...inherited,
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        // 让浏览器与 curl 都别做指数退避重连得太久；客户端仍可按自己的策略覆盖。
        raw.write("retry: 3000\n\n");

        /**
         * 每条作业最后发出去的那一版：`updatedAt` + 状态 + 阶段。
         *
         * 光比 `updatedAt` 不够——同一个回合里「领取」「报进度」「完成」可能落在同一毫秒，
         * 时间戳相同但内容不同；按内容去重才不会把后两步当重复丢掉。
         * `updatedAt` 仍然只用作补发游标（补发按 `>` 查，同毫秒的多次变更取最终态）。
         */
        const sent = new Map<string, { signature: string; updatedAt: string }>();
        let closed = false;
        let chain: Promise<void> = Promise.resolve();

        const writeView = (view: TurnJobView): void => {
          if (closed) {
            return;
          }
          const signature = `${view.updatedAt}|${view.status}|${view.progress?.step ?? ""}`;
          if (sent.get(view.jobId)?.signature === signature) {
            return;
          }
          sent.set(view.jobId, { signature, updatedAt: view.updatedAt });
          raw.write(
            `id: ${view.updatedAt}\nevent: job\ndata: ${JSON.stringify({ job: view })}\n\n`,
          );
        };

        /** 补发：一条 SQL 拿到这一局的全部变更，按时间升序写出去。 */
        const replay = async (cursor: Date | undefined): Promise<void> => {
          const views = await listTurnJobs(
            db(),
            game.id,
            cursor === undefined ? {} : { updatedSince: cursor },
          );
          for (const view of [...views].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
            writeView(view);
          }
        };

        const latestCursor = (): string | undefined => {
          let latest: string | undefined;
          for (const { updatedAt } of sent.values()) {
            if (latest === undefined || updatedAt > latest) {
              latest = updatedAt;
            }
          }
          return latest;
        };

        /**
         * 串行化写入：补发与实时可能同时到达，用一个 Promise 链保证同一条流上的
         * 事件不交错、游标单调前进。
         */
        const enqueue = (task: () => Promise<void>): void => {
          chain = chain.then(task).catch((error: unknown) => {
            request.log.warn({ err: error }, "作业推送写入失败");
          });
        };

        const unsubscribe = broker.subscribe((event) => {
          if (event.type === "resync") {
            // 订阅重连过：断线期间的通知全丢了，按已发出的游标补一遍。
            enqueue(async () => {
              const cursor = latestCursor();
              await replay(cursor === undefined ? undefined : new Date(cursor));
            });
            return;
          }
          if (event.change.serializationKey !== key) {
            return;
          }
          // 通知只带 jobId：内容回库里读，推出去的东西与 `GET jobs/:job` 永远同源。
          enqueue(async () => {
            const view = await readTurnJob(db(), game.id, event.change.jobId);
            if (view !== null) {
              writeView(view);
            }
          });
        });

        const heartbeat = setInterval(() => {
          if (!closed) {
            raw.write(": ping\n\n");
          }
        }, HEARTBEAT_INTERVAL_MS);
        heartbeat.unref();

        const cleanup = (): void => {
          if (closed) {
            return;
          }
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
        };
        request.raw.on("close", cleanup);
        raw.on("close", cleanup);
        raw.on("error", cleanup);

        enqueue(() => replay(since));
        return reply;
      },
    );
  };
}
