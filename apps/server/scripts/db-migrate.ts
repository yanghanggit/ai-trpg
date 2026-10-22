import { openDatabase } from "../src/db/connect";
import { runMigrations } from "../src/db/migrate";

async function main(): Promise<void> {
  const { db, pool } = openDatabase();
  try {
    await runMigrations(db);
    console.log(JSON.stringify({ ok: true, action: "db-migrate" }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, action: "db-migrate", error: String(error) }));
  process.exit(1);
});
