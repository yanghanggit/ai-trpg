CREATE TABLE "actor_controls" (
	"actor_id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"controller_type" text DEFAULT 'player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actor_controls" ADD CONSTRAINT "actor_controls_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_controls" ADD CONSTRAINT "actor_controls_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_controls" ADD CONSTRAINT "actor_controls_player_id_game_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;