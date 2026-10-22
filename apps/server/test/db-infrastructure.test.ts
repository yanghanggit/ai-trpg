import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/db/env";
import { type DatabaseHandle, openDatabase } from "../src/db/connect";
import { assertLocalDatabase } from "../src/db/maintenance";
import { runMigrations } from "../src/db/migrate";
import { appMeta } from "../src/db/schema";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!testDatabaseUrl)("database infrastructure", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = openDatabase("TEST_DATABASE_URL");
    await runMigrations(handle.db);
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  it("connects to the test database and round-trips app_meta", async () => {
    const key = `test:${Date.now()}`;
    await handle.db
      .insert(appMeta)
      .values({ key, value: { ok: true } })
      .onConflictDoUpdate({ target: appMeta.key, set: { value: { ok: true } } });

    const rows = await handle.db.select().from(appMeta).where(eq(appMeta.key, key));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toEqual({ ok: true });

    await handle.db.delete(appMeta).where(eq(appMeta.key, key));
  });
});

describe("database guard", () => {
  it("allows local database URLs", () => {
    expect(() => assertLocalDatabase("postgresql://u@127.0.0.1:5432/db")).not.toThrow();
    expect(() => assertLocalDatabase("postgresql://u@localhost:5432/db")).not.toThrow();
  });

  it("rejects non-local database URLs", () => {
    expect(() => assertLocalDatabase("postgresql://u@example.com:5432/db")).toThrow();
  });
});
