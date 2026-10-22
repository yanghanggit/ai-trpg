import { openDatabase } from "../src/db/connect";
import { assertLocalDatabase, resetDomainData, seedDemoData } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";

async function main(): Promise<void> {
  const { databaseUrl, db, pool } = openDatabase();
  try {
    assertLocalDatabase(databaseUrl);
    await runMigrations(db);
    await resetDomainData(db);
    await seedDemoData(db);
    console.log(JSON.stringify({ ok: true, action: "db-demo", seed: "demo" }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, action: "db-demo", error: String(error) }));
  process.exit(1);
});
