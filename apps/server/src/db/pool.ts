import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export type DbPoolOptions = {
  connectionString: string;
  max?: number;
  statementTimeoutMs?: number;
  connectionTimeoutMs?: number;
};

export function createDbPool({
  connectionString,
  max = 10,
  statementTimeoutMs = 10_000,
  connectionTimeoutMs = 5_000,
}: DbPoolOptions): Pool {
  return new Pool({
    connectionString,
    max,
    statement_timeout: statementTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
    application_name: "ai-trpg-server",
  });
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}
