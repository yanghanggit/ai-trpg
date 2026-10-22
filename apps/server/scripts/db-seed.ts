import { openDatabase } from "../src/db/connect";
import { seedDemoData } from "../src/db/maintenance";

async function main(): Promise<void> {
  const { db, pool } = openDatabase();
  try {
    await seedDemoData(db);
    console.log(JSON.stringify({ ok: true, action: "db-seed", seed: "demo" }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, action: "db-seed", error: String(error) }));
  process.exit(1);
});
