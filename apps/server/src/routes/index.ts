import { API_VERSION, APP_VERSION, SERVICE_NAME } from "@ai-trpg/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../db/pool";
import { createGameRoutes } from "./games";
import { healthRoutes } from "./health";
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
export function createRoutes(db: () => Database): FastifyPluginAsyncZod {
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
    await app.register(createGameRoutes(db), { prefix: `/api/${API_VERSION}` });
    await app.register(createTraceRoutes(db), { prefix: `/api/${API_VERSION}` });
  };
}
