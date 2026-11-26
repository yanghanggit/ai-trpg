/**
 * 节点自述：这个进程是谁、连的哪个库、轨迹写在哪个目录。
 *
 * 后台首页按「身份 → 节点 → 局」三层读：身份回答「我在用谁看」，节点回答「看的是哪台机器」，
 * 局才是业务内容。这一层只该出现**进程事实**，不掺业务读数——所以它照实描述「这个进程」，
 * 而不是「这个部署」：现在 HTTP 与 worker 同进程，多进程要等 `pnpm job:worker` 那种形态。
 *
 * 这里直接读 `process.env` 而不是走 `Env`：被描述的对象就是进程本身，连库地址与轨迹目录
 * 都是进程的启动环境，不是业务配置。库的凭据不出现，只留可用来对照的 host / port / name。
 */

import { readdir } from "node:fs/promises";
import { API_VERSION, APP_VERSION, SERVICE_NAME } from "@ai-trpg/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Database } from "../db/pool";
import { traceEnabled, traceRoot } from "../debug/trace";
import { requireAdmin } from "../plugins/auth";

const statusResponseSchema = z
  .object({
    service: z.string(),
    version: z.string(),
    apiVersion: z.string(),
    listen: z.object({ host: z.string(), port: z.number() }),
    process: z.object({
      pid: z.number(),
      nodeVersion: z.string(),
      platform: z.string(),
      startedAt: z.iso.datetime(),
      uptimeSeconds: z.number().nonnegative(),
    }),
    /** 连接串解析失败时为 null；后台据此显示「未知」而不是编一个默认值。 */
    database: z.object({ name: z.string(), host: z.string(), port: z.string() }).nullable(),
    trace: z.object({
      enabled: z.boolean(),
      dir: z.string(),
      /** 目录不存在时也算 0：那时「有多少局」这个问题没有意义。 */
      gameDirs: z.number(),
    }),
  })
  .meta({ id: "NodeStatus" });

export type StatusListen = { host: string; port: number };

export function createStatusRoutes(
  db: () => Database,
  listen: StatusListen,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/status",
      {
        schema: {
          tags: ["system"],
          summary: "节点自述：进程、数据库与轨迹目录",
          description:
            "后台首页的「节点」一层用它回答「看的是哪台机器」。只描述当前进程，" +
            "不做跨进程汇总；HTTP 与 worker 同进程是当前形态。",
          response: { 200: statusResponseSchema },
        },
      },
      async (request) => {
        await requireAdmin(db(), request);
        const startedAt = new Date(Date.now() - Math.round(process.uptime() * 1000));
        return {
          service: SERVICE_NAME,
          version: APP_VERSION,
          apiVersion: API_VERSION,
          listen,
          process: {
            pid: process.pid,
            nodeVersion: process.version,
            platform: `${process.platform}/${process.arch}`,
            startedAt: startedAt.toISOString(),
            uptimeSeconds: Math.round(process.uptime()),
          },
          database: describeDatabaseUrl(process.env.DATABASE_URL),
          trace: {
            enabled: traceEnabled(),
            dir: traceRoot(),
            gameDirs: await countDirs(traceRoot()),
          },
        };
      },
    );
  };
}

/**
 * 只留 host / port / name。
 *
 * 用户名与密码一律不出现：这块读数可以在浏览器里看到，凭据不该跟着走到那里。
 */
function describeDatabaseUrl(raw: string | undefined): {
  name: string;
  host: string;
  port: string;
} | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    const name = url.pathname.replace(/^\//, "");
    if (name.length === 0) {
      return null;
    }
    // 走 unix socket 时 hostname 为空，查询串里才是真实路径：不做解析，标成 unknown。
    return { name, host: url.hostname === "" ? "unknown" : url.hostname, port: url.port };
  } catch {
    return null;
  }
}

async function countDirs(root: string): Promise<number> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}
