import { openDatabase } from "../src/db/connect";

async function main(): Promise<void> {
  const { pool } = openDatabase();
  try {
    const result = await pool.query<{
      database: string;
      user: string;
      version: string;
      app_meta_count: string;
      vector_version: string | null;
      vector_document_count: string;
    }>(
      `SELECT current_database() AS database,
              current_user AS "user",
              version() AS version,
              (SELECT count(*) FROM app_meta)::text AS app_meta_count,
              (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vector_version,
              (SELECT count(*) FROM vector_documents)::text AS vector_document_count`,
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("数据库探针没有返回结果");
    }
    console.log(
      JSON.stringify({
        ok: true,
        action: "db-check",
        database: row.database,
        user: row.user,
        serverVersion: row.version.split(" ").slice(0, 2).join(" "),
        appMetaRows: Number(row.app_meta_count),
        pgvectorVersion: row.vector_version,
        vectorDocumentRows: Number(row.vector_document_count),
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, action: "db-check", error: String(error) }));
  process.exit(1);
});
