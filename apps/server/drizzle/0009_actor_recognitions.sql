-- 旧行可能存的是别名（称呼）。识别关系只保留「知道真名」的行：
-- 别名行删除后，该观察者对这具形象回到不认识，不会凭空获得真名。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'name_knowledge' AND column_name = 'name'
  ) THEN
    DELETE FROM "name_knowledge" nk
    USING "actor_presentations" p, "actors" a
    WHERE nk."presentation_id" = p."id"
      AND p."actor_id" = a."id"
      AND nk."name" <> a."name";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "name_knowledge" RENAME TO "actor_recognitions";--> statement-breakpoint
ALTER TABLE "actor_recognitions" DROP CONSTRAINT "name_knowledge_game_id_games_id_fk";
--> statement-breakpoint
ALTER TABLE "actor_recognitions" DROP CONSTRAINT "name_knowledge_observer_actor_id_actors_id_fk";
--> statement-breakpoint
ALTER TABLE "actor_recognitions" DROP CONSTRAINT "name_knowledge_presentation_id_actor_presentations_id_fk";
--> statement-breakpoint
ALTER TABLE "actor_recognitions" DROP CONSTRAINT "name_knowledge_learned_stage_id_stages_id_fk";
--> statement-breakpoint
DROP INDEX "name_knowledge_observer_presentation_unique";--> statement-breakpoint
DROP INDEX "name_knowledge_game_observer_idx";--> statement-breakpoint
ALTER TABLE "actor_recognitions" ADD CONSTRAINT "actor_recognitions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_recognitions" ADD CONSTRAINT "actor_recognitions_observer_actor_id_actors_id_fk" FOREIGN KEY ("observer_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_recognitions" ADD CONSTRAINT "actor_recognitions_presentation_id_actor_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."actor_presentations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_recognitions" ADD CONSTRAINT "actor_recognitions_learned_stage_id_stages_id_fk" FOREIGN KEY ("learned_stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actor_recognitions_observer_presentation_unique" ON "actor_recognitions" USING btree ("observer_actor_id","presentation_id");--> statement-breakpoint
CREATE INDEX "actor_recognitions_game_observer_idx" ON "actor_recognitions" USING btree ("game_id","observer_actor_id");--> statement-breakpoint
ALTER TABLE "actor_recognitions" DROP COLUMN IF EXISTS "name";