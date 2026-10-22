import type { Pool } from "pg";
import { requireDatabaseUrl } from "./env";
import { createDatabase, createDbPool, type Database } from "./pool";

export type DatabaseHandle = {
  databaseUrl: string;
  pool: Pool;
  db: Database;
};

function poolMax(): number {
  const raw = process.env.DB_POOL_MAX?.trim();
  if (!raw) {
    return 10;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`DB_POOL_MAX 必须是正整数，当前为 ${raw}`);
  }
  return value;
}

export function openDatabase(databaseUrlName = "DATABASE_URL"): DatabaseHandle {
  const databaseUrl = requireDatabaseUrl(databaseUrlName);
  const pool = createDbPool({ connectionString: databaseUrl, max: poolMax() });
  return { databaseUrl, pool, db: createDatabase(pool) };
}
