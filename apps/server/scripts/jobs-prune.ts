/**
 * 清掉「局已经删了、作业还留着」的那些行。
 *
 * 作业表不挂外键（`gameId` 在 payload 里），删局不会级联清作业——这是刻意的：
 * 归档策略还没定，先别自动删。这个脚本只在需要时手动跑一次：
 *
 * - 默认只报告，不动数据；
 * - 加 `--apply` 才真删。
 *
 * 只处理带 `gameId` 的作业（回合作业）；别的作业没有「属于哪一局」这回事，不碰。
 */

import { openDatabase } from "../src/db/connect";

type StatusCount = { status: string; count: string };

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { pool } = openDatabase();

  try {
    const orphans = await pool.query<StatusCount>(
      `SELECT status, count(*)::text AS count
         FROM jobs j
        WHERE j.payload ? 'gameId'
          AND NOT EXISTS (
            SELECT 1 FROM games g WHERE g.id::text = j.payload ->> 'gameId'
          )
        GROUP BY status
        ORDER BY status`,
    );
    const total = await pool.query<{ total: string }>("SELECT count(*)::text AS total FROM jobs");
    const orphanCount = orphans.rows.reduce((sum, row) => sum + Number(row.count), 0);

    let deleted = 0;
    if (apply && orphanCount > 0) {
      const result = await pool.query<{ id: string }>(
        `DELETE FROM jobs j
          WHERE j.payload ? 'gameId'
            AND NOT EXISTS (
              SELECT 1 FROM games g WHERE g.id::text = j.payload ->> 'gameId'
            )
          RETURNING j.id`,
      );
      deleted = result.rowCount ?? 0;
    }

    console.log(
      JSON.stringify({
        ok: true,
        action: "jobs-prune",
        apply,
        total: Number(total.rows[0]?.total ?? 0),
        orphan: orphanCount,
        deleted,
        byStatus: Object.fromEntries(orphans.rows.map((row) => [row.status, Number(row.count)])),
      }),
    );
    if (!apply && orphanCount > 0) {
      console.log(JSON.stringify({ hint: "加 --apply 才会真删" }));
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, action: "jobs-prune", error: String(error) }));
  process.exit(1);
});
