import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./pool";

/** `apps/server/drizzle`，与 drizzle.config.ts 的 out 保持一致。 */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  // vector 列必须在 Drizzle 迁移建表前可用。扩展由数据库 owner 提供；
  // 生产环境可改为预置扩展，这里的 IF NOT EXISTS 是开发/测试的兜底。
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
