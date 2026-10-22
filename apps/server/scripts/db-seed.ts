import { openDatabase } from "../src/db/connect";
import { seedPlaceholder } from "../src/db/maintenance";

async function main(): Promise<void> {
  const { db, pool } = openDatabase();
  try {
    await seedPlaceholder(db);
    console.log(JSON.stringify({ ok: true, action: "db-seed", seed: "placeholder" }));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, action: "db-seed", error: String(error) }));
  process.exit(1);
});
