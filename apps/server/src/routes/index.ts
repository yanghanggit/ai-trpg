import { API_VERSION, APP_VERSION, SERVICE_NAME } from "@ai-trpg/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { healthRoutes } from "./health";

const rootResponseSchema = z.object({
  service: z.string(),
  version: z.string(),
  health: z.string(),
});

export const registerRoutes: FastifyPluginAsyncZod = async (app) => {
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
};
