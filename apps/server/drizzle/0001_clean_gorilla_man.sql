-- 旧数据兼容：把 0 / 重复的 stage seq 重新分配为局内更大的实体序号，
-- 并同步 games.entity_seq，随后再加唯一索引。
WITH stage_bounds AS (
  SELECT w.game_id,
         GREATEST(
           COALESCE((SELECT MAX(w2.seq) FROM worlds w2 WHERE w2.game_id = w.game_id), 0),
           COALESCE((SELECT MAX(s2.seq) FROM stages s2 JOIN worlds w3 ON w3.id = s2.world_id WHERE w3.game_id = w.game_id), 0),
           COALESCE((SELECT MAX(a.seq) FROM actors a JOIN stages s3 ON s3.id = a.stage_id JOIN worlds w4 ON w4.id = s3.world_id WHERE w4.game_id = w.game_id), 0),
           COALESCE((SELECT MAX(sig.seq) FROM actor_signatures sig JOIN actors a2 ON a2.id = sig.actor_id JOIN stages s4 ON s4.id = a2.stage_id JOIN worlds w5 ON w5.id = s4.world_id WHERE w5.game_id = w.game_id), 0),
           COALESCE((SELECT MAX(i.seq) FROM items i JOIN actors a3 ON a3.id = i.actor_id JOIN stages s5 ON s5.id = a3.stage_id JOIN worlds w6 ON w6.id = s5.world_id WHERE w6.game_id = w.game_id), 0),
           COALESCE((SELECT MAX(si.seq) FROM stage_items si JOIN stages s6 ON s6.id = si.stage_id JOIN worlds w7 ON w7.id = s6.world_id WHERE w7.game_id = w.game_id), 0)
         ) AS max_seq
  FROM worlds w
  GROUP BY w.game_id
),
targets AS (
  SELECT s.id,
         b.max_seq,
         ROW_NUMBER() OVER (PARTITION BY b.game_id ORDER BY s.ordinal, s.created_at, s.id) AS rn
  FROM stages s
  JOIN worlds w ON w.id = s.world_id
  JOIN stage_bounds b ON b.game_id = w.game_id
  WHERE s.seq <= 0
     OR EXISTS (
       SELECT 1
       FROM stages other
       WHERE other.world_id = s.world_id
         AND other.seq = s.seq
         AND other.id <> s.id
     )
)
UPDATE stages s
SET seq = t.max_seq + t.rn
FROM targets t
WHERE s.id = t.id;
--> statement-breakpoint
UPDATE games g
SET entity_seq = GREATEST(
  g.entity_seq,
  COALESCE((SELECT MAX(w.seq) FROM worlds w WHERE w.game_id = g.id), 0),
  COALESCE((SELECT MAX(s.seq) FROM stages s JOIN worlds w ON w.id = s.world_id WHERE w.game_id = g.id), 0),
  COALESCE((SELECT MAX(a.seq) FROM actors a JOIN stages s ON s.id = a.stage_id JOIN worlds w ON w.id = s.world_id WHERE w.game_id = g.id), 0),
  COALESCE((SELECT MAX(sig.seq) FROM actor_signatures sig JOIN actors a ON a.id = sig.actor_id JOIN stages s ON s.id = a.stage_id JOIN worlds w ON w.id = s.world_id WHERE w.game_id = g.id), 0),
  COALESCE((SELECT MAX(i.seq) FROM items i JOIN actors a ON a.id = i.actor_id JOIN stages s ON s.id = a.stage_id JOIN worlds w ON w.id = s.world_id WHERE w.game_id = g.id), 0),
  COALESCE((SELECT MAX(si.seq) FROM stage_items si JOIN stages s ON s.id = si.stage_id JOIN worlds w ON w.id = s.world_id WHERE w.game_id = g.id), 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stages_world_seq_unique" ON "stages" USING btree ("world_id","seq");
