import { config } from "dotenv";
import { ROOT_ENV_FILE } from "../env";

config({ path: ROOT_ENV_FILE, quiet: true });

export function requireDatabaseUrl(name = "DATABASE_URL"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`❌ 未设置 ${name}；请检查仓库根目录的 .env`);
    process.exit(1);
  }
  return value;
}
