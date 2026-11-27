import { sql } from "drizzle-orm";
import { SEED_USERS } from "../identity";
import type { Database } from "./pool";
import { appMeta, users } from "./schema";

/**
 * 开发期重置的显式表清单。新增业务表时必须在这里登记，
 * 避免 reset 漏表或误删迁移表 / 扩展。
 */
export const DOMAIN_TABLES = [
  "jobs",
  "agent_memory_messages",
  "agent_memories",
  "action_order_turns",
  "action_order_entries",
  "action_orders",
  "game_messages",
  "vector_documents",
  "actor_controls",
  "dialogue_blocks",
  "actor_signature_names",
  "appearances",
  "items",
  "stage_items",
  "stage_visits",
  "actor_signatures",
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

/** 开发期的两个身份：玩家（`demo`）与运维（`admin`）。 */
export async function seedDemoData(db: Database): Promise<void> {
  for (const user of SEED_USERS) {
    await db
      .insert(users)
      .values({ id: user.id, username: user.username, displayName: user.displayName })
      .onConflictDoUpdate({
        target: users.username,
        set: { displayName: user.displayName, updatedAt: new Date() },
      });
  }

  await db
    .insert(appMeta)
    .values({
      key: "demo",
      value: { version: 1, fixture: "seed-users" },
    })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: { version: 1, fixture: "seed-users" }, updatedAt: new Date() },
    });
}
