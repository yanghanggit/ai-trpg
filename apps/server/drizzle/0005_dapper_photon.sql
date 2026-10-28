CREATE TABLE "dialogue_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"action_kind" text NOT NULL,
	"target_actor_id" uuid,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"failure_kind" text,
	"model" text,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dialogue_blocks" ADD CONSTRAINT "dialogue_blocks_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_blocks" ADD CONSTRAINT "dialogue_blocks_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_blocks" ADD CONSTRAINT "dialogue_blocks_player_id_game_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_blocks" ADD CONSTRAINT "dialogue_blocks_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dialogue_blocks_game_created_idx" ON "dialogue_blocks" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "dialogue_blocks_game_hash_idx" ON "dialogue_blocks" USING btree ("game_id","content_hash");