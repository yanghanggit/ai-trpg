CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"owner_type" text DEFAULT 'actor' NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"context_usage_ratio" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"memory_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"tool_call_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actors" DROP CONSTRAINT "actors_controller_player_id_game_players_id_fk";
--> statement-breakpoint
ALTER TABLE "game_messages" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_messages" ADD CONSTRAINT "agent_memory_messages_memory_id_agent_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."agent_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memories_game_owner_unique" ON "agent_memories" USING btree ("game_id","owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memory_messages_memory_sequence_unique" ON "agent_memory_messages" USING btree ("memory_id","sequence");--> statement-breakpoint
ALTER TABLE "game_messages" ADD CONSTRAINT "game_messages_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "controller_player_id";