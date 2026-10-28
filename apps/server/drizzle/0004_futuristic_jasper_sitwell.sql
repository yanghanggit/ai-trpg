CREATE TABLE "name_knowledge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"observer_actor_id" uuid NOT NULL,
	"presentation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text DEFAULT 'self' NOT NULL,
	"learned_stage_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "name_knowledge" ADD CONSTRAINT "name_knowledge_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_knowledge" ADD CONSTRAINT "name_knowledge_observer_actor_id_actors_id_fk" FOREIGN KEY ("observer_actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_knowledge" ADD CONSTRAINT "name_knowledge_presentation_id_actor_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."actor_presentations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_knowledge" ADD CONSTRAINT "name_knowledge_learned_stage_id_stages_id_fk" FOREIGN KEY ("learned_stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "name_knowledge_observer_presentation_unique" ON "name_knowledge" USING btree ("observer_actor_id","presentation_id");--> statement-breakpoint
CREATE INDEX "name_knowledge_game_observer_idx" ON "name_knowledge" USING btree ("game_id","observer_actor_id");