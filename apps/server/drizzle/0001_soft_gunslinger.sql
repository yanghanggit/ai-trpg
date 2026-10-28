ALTER TABLE "actors" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "entity_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "worlds" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- 回填：每局按 world → stage → stage item → actor → item 的固定顺序取号，并把计数器推到最大号。
CREATE TEMP TABLE entity_seq_backfill AS
WITH entity_rows AS (
  SELECT w.game_id, w.id, 0 AS kind_rank, 0 AS ord, w.created_at
  FROM worlds w
  UNION ALL
  SELECT w.game_id, s.id, 1, s.ordinal, s.created_at
  FROM stages s JOIN worlds w ON w.id = s.world_id
  UNION ALL
  SELECT w.game_id, si.id, 2, s.ordinal, si.created_at
  FROM stage_items si JOIN stages s ON s.id = si.stage_id JOIN worlds w ON w.id = s.world_id
  UNION ALL
  SELECT w.game_id, a.id, 3, s.ordinal, a.created_at
  FROM actors a JOIN stages s ON s.id = a.stage_id JOIN worlds w ON w.id = s.world_id
  UNION ALL
  SELECT w.game_id, i.id, 4, s.ordinal, i.created_at
  FROM items i JOIN actors a ON a.id = i.actor_id JOIN stages s ON s.id = a.stage_id JOIN worlds w ON w.id = s.world_id
), ranked AS (
  SELECT game_id, id, row_number() OVER (PARTITION BY game_id ORDER BY kind_rank, ord, created_at, id)::integer AS seq
  FROM entity_rows
)
SELECT game_id, id, seq FROM ranked;--> statement-breakpoint
UPDATE worlds w SET seq = b.seq FROM entity_seq_backfill b WHERE b.id = w.id;--> statement-breakpoint
UPDATE stages s SET seq = b.seq FROM entity_seq_backfill b WHERE b.id = s.id;--> statement-breakpoint
UPDATE stage_items si SET seq = b.seq FROM entity_seq_backfill b WHERE b.id = si.id;--> statement-breakpoint
UPDATE actors a SET seq = b.seq FROM entity_seq_backfill b WHERE b.id = a.id;--> statement-breakpoint
UPDATE items i SET seq = b.seq FROM entity_seq_backfill b WHERE b.id = i.id;--> statement-breakpoint
UPDATE games g SET entity_seq = COALESCE(
  (SELECT max(b.seq) FROM entity_seq_backfill b WHERE b.game_id = g.id),
  0
);
--> statement-breakpoint
DROP TABLE IF EXISTS entity_seq_backfill;
