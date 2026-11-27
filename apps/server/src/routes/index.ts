import { API_VERSION, APP_VERSION, SERVICE_NAME } from "@ai-trpg/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../db/pool";
import type { JobChangeBroker } from "../jobs";
import { createGameRoutes } from "./games";
import { healthRoutes } from "./health";
import { createJobStreamRoutes } from "./job-stream";
import { createStatusRoutes, type StatusListen } from "./status";
import type { StreamLimits } from "./stream-limits";
import { createTraceRoutes } from "./traces";

const rootResponseSchema = z.object({
  service: z.string(),
  version: z.string(),
  health: z.string(),
});

/**
 * 装配所有路由；数据库用访问器传入，装配阶段不建立连接，
 * 因此 `gen:openapi` 可以在没有数据库的情况下导出完整契约。
 */
export type RouteOptions = {
  /** 作业状态推送的订阅源；不传时 SSE 入口回 503，其它入口照常工作。 */
  broker?: JobChangeBroker;
  /** 服务端实际监听的地址；节点自述用它回答「这个进程开在哪个端口」。 */
  listen?: StatusListen;
  /** SSE 的三条上限；用例会把它调小，线上用默认值。 */
  streamLimits?: StreamLimits;
};

export function createRoutes(
  db: () => Database,
  options: RouteOptions = {},
): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/",
      {
        schema: {
          tags: ["system"],
          summary: "服务标识",
          response: { 200: rootResponseSchema },
        },
      },
      async () => ({
        service: SERVICE_NAME,
        version: APP_VERSION,
        health: `/api/${API_VERSION}/health`,
      }),
    );

    await app.register(healthRoutes, { prefix: `/api/${API_VERSION}` });
    await app.register(createStatusRoutes(db, options.listen ?? { host: "?", port: 0 }), {
      prefix: `/api/${API_VERSION}`,
    });
    // 先挂流式入口：`jobs/stream` 是静态段，先注册也便于在路由表里一眼看到它在 `jobs/:job` 之前。
    await app.register(createJobStreamRoutes(db, options.broker, options.streamLimits ?? {}), {
      prefix: `/api/${API_VERSION}`,
    });
    await app.register(createGameRoutes(db), { prefix: `/api/${API_VERSION}` });
    await app.register(createTraceRoutes(db), { prefix: `/api/${API_VERSION}` });
  };
}
