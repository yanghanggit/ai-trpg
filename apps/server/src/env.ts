import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_PORT } from "@ai-trpg/shared";
import { z } from "zod";

/** 仓库根目录的 `.env`；server / web 共用这一份。 */
export const ROOT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_SERVER_PORT),
  CORS_ORIGINS: z.string().default("*"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DEEPSEEK_API_KEY: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** 校验环境变量；失败时打印可读原因并以非零码退出，不做静默兜底。 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error("❌ 环境变量校验失败：");
    console.error(z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export function parseCorsOrigins(value: string): "*" | string[] {
  const trimmed = value.trim();
  if (trimmed === "*") {
    return "*";
  }
  return trimmed
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
