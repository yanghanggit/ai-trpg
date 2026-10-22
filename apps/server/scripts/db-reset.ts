import { openDatabase } from "../src/db/connect";
import { assertLocalDatabase, resetDomainData } from "../src/db/maintenance";

async function main(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    throw new Error("db-reset 会清空开发数据，确认后请加 --yes");
  }

  const { databaseUrl, db, pool } = openDatabase();
  try {
    assertLocalDatabase(databaseUrl);
    await resetDomainData(db);
    console.log(JSON.stringify({ ok: true, action: "db-reset" }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, action: "db-reset", error: String(error) }));
  process.exit(1);
});
