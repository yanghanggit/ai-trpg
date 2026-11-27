import { API_VERSION, APP_VERSION } from "@ai-trpg/shared";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Database } from "./db/pool";
import type { Env } from "./env";
import { parseCorsOrigins } from "./env";
import { isAdmin } from "./identity";
import type { JobChangeBroker } from "./jobs";
import { assertAdminToken, claimedUsername } from "./plugins/auth";
import { registerErrorHandler } from "./plugins/error-handler";
import { createRoutes } from "./routes";

export type BuildAppOptions = {
  env: Env;
  /** 测试与 OpenAPI 生成时关闭日志，避免污染输出。 */
  logger?: boolean;
  /**
   * 数据库访问器：装配阶段不建连接，只有真正处理请求时才取用。
   * 连接池由进程入口持有（`src/index.ts`），离线导出 OpenAPI 传一个不会被调用的桩。
   */
  db: () => Database;
  /** 作业状态推送的订阅源；由进程入口持有并启动，测试可以不传。 */
  broker?: JobChangeBroker;
};

/** 组装一个可注入、可测试的 Fastify 实例；监听端口由调用方负责。 */
export async function buildApp({
  env,
  logger = true,
  db,
  broker,
}: BuildAppOptions): Promise<FastifyInstance> {
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

  // 方法要显式列全：@fastify/cors 缺省只放 GET/HEAD/POST，而删局是 DELETE——
  // 浏览器会先在预检里被拒，报出来的却是「连不上服务端」，极难查。
  await app.register(cors, {
    origin: parseCorsOrigins(env.CORS_ORIGINS),
    methods: ["GET", "HEAD", "POST", "DELETE"],
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "AI TRPG API",
        description: "AI 跑团服务端的 HTTP 契约；客户端类型由它生成。",
        version: APP_VERSION,
      },
      tags: [
        { name: "system", description: "服务状态与元信息" },
        { name: "account", description: "开发期身份" },
        { name: "games", description: "建局、状态与事件流" },
        { name: "actions", description: "接管与玩家动作" },
        { name: "turns", description: "显式推进会话的一层" },
        { name: "inspect", description: "探针、记忆与名字审计" },
        { name: "traces", description: "过程轨迹（只读）" },
      ],
    },
    transform: jsonSchemaTransform,
    // 带 `id` 的 schema（`.meta({ id })`）进 `components.schemas`：客户端因此拿到具名类型。
    transformObject: jsonSchemaTransformObject,
  });

  registerErrorHandler(app);

  // 后台口令守卫：自称 `admin` 的请求先过这道闸，再谈「你是不是运维」。
  // 放在全局而不是逐路由，是因为 admin 身份在每个入口都被 `requireUser` 放行过一次，
  // 逐处补就会漏一处；这里只看请求头，不查库。
  app.addHook("onRequest", async (request) => {
    if (isAdmin(claimedUsername(request, { allowQueryToken: true }))) {
      assertAdminToken(request, env.ADMIN_TOKEN);
    }
  });

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  await app.register(
    createRoutes(db, {
      ...(broker === undefined ? {} : { broker }),
      listen: { host: env.HOST, port: env.PORT },
    }),
  );

  if (env.NODE_ENV === "production" && env.CORS_ORIGINS.trim() === "*") {
    app.log.warn("CORS_ORIGINS=* 仅建议用于开发环境，生产环境请配置具体来源");
  }

  app.log.debug({ apiVersion: API_VERSION }, "路由已注册");

  return app;
}
