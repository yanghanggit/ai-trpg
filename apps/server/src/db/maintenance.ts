import { sql } from "drizzle-orm";
import { DEMO_USER } from "../../seeds/dark-fantasy";
import type { Database } from "./pool";
import { appMeta, users } from "./schema";

/**
 * 开发期重置的显式表清单。新增业务表时必须在这里登记，
 * 避免 reset 漏表或误删迁移表 / 扩展。
 */
export const DOMAIN_TABLES = [
  "agent_memory_messages",
  "agent_memories",
  "game_messages",
  "vector_documents",
  "actor_controls",
  "items",
  "stage_items",
  "actors",
  "stage_connections",
  "stages",
  "worlds",
  "game_players",
  "games",
  "users",
  "app_meta",
] as const;

export function assertLocalDatabase(databaseUrl: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("拒绝在生产环境执行数据库重置 / 演示初始化");
  }

  const { hostname } = new URL(databaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(hostname)) {
    throw new Error(`拒绝在非本机数据库执行破坏性操作: ${hostname}`);
  }
}

export async function resetDomainData(db: Database): Promise<void> {
  const tables = DOMAIN_TABLES.map((table) => `"${table}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`));
}

export async function seedDemoData(db: Database): Promise<void> {
  await db
    .insert(users)
    .values({
      id: DEMO_USER.id,
      username: DEMO_USER.username,
      displayName: DEMO_USER.displayName,
    })
    .onConflictDoUpdate({
      target: users.username,
      set: { displayName: DEMO_USER.displayName, updatedAt: new Date() },
    });

  await db
    .insert(appMeta)
    .values({
      key: "demo",
      value: { version: 1, seed: "dark-fantasy.v2" },
    })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: { version: 1, seed: "dark-fantasy.v2" }, updatedAt: new Date() },
    });
}
