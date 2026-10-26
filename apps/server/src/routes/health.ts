import { API_VERSION, APP_VERSION, SERVICE_NAME } from "@ai-trpg/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  apiVersion: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  serverTime: z.iso.datetime(),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "服务健康检查",
        description: "客户端用这个接口确认服务端可达，并展示版本与运行时长。",
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({
      status: "ok" as const,
      service: SERVICE_NAME,
      version: APP_VERSION,
      apiVersion: API_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      serverTime: new Date().toISOString(),
    }),
  );
};
