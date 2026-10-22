import { API_VERSION, APP_VERSION } from "@ai-trpg/shared";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./env";
import { parseCorsOrigins } from "./env";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerRoutes } from "./routes";

export type BuildAppOptions = {
  env: Env;
  /** 测试与 OpenAPI 生成时关闭日志，避免污染输出。 */
  logger?: boolean;
};

/** 组装一个可注入、可测试的 Fastify 实例；监听端口由调用方负责。 */
export async function buildApp({ env, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const loggerConfig: FastifyServerOptions["logger"] = logger
    ? {
        level: env.LOG_LEVEL,
        transport:
          env.NODE_ENV === "development"
            ? {
                target: "pino-pretty",
                options: { translateTime: "SYS:standard", ignore: "pid,hostname" },
              }
            : undefined,
      }
    : false;

  const app = Fastify({ logger: loggerConfig }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: parseCorsOrigins(env.CORS_ORIGINS) });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "AI TRPG API",
        description: "AI 跑团服务端的 HTTP 契约；客户端类型由它生成。",
        version: APP_VERSION,
      },
      tags: [{ name: "system", description: "服务状态与元信息" }],
    },
    transform: jsonSchemaTransform,
  });

  registerErrorHandler(app);

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  await app.register(registerRoutes);

  if (env.NODE_ENV === "production" && env.CORS_ORIGINS.trim() === "*") {
    app.log.warn("CORS_ORIGINS=* 仅建议用于开发环境，生产环境请配置具体来源");
  }

  app.log.debug({ apiVersion: API_VERSION }, "路由已注册");

  return app;
}
