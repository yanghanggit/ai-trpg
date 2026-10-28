CREATE TABLE "stage_visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"first_visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_visited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "teleport_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_visits" ADD CONSTRAINT "stage_visits_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_visits" ADD CONSTRAINT "stage_visits_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_visits" ADD CONSTRAINT "stage_visits_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stage_visits_actor_stage_unique" ON "stage_visits" USING btree ("actor_id","stage_id");--> statement-breakpoint
CREATE INDEX "stage_visits_game_actor_idx" ON "stage_visits" USING btree ("game_id","actor_id");