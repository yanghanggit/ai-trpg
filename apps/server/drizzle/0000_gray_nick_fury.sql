CREATE TABLE "actor_controls" (
	"actor_id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"controller_type" text DEFAULT 'player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stage_id" uuid NOT NULL,
	"name" text NOT NULL,
	"profile" text NOT NULL,
	"appearance" text NOT NULL,
	"base_body" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"hp" integer NOT NULL,
	"death_settled_at" timestamp with time zone,
	"is_default_player" boolean DEFAULT false NOT NULL,
	"equipment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"stage_id" uuid,
	"source_actor_id" uuid,
	"target_actor_id" uuid,
	"visibility" text DEFAULT 'stage' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"outcome" text,
	"content_version" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"source" text,
	"count" integer DEFAULT 1 NOT NULL,
	"stats" jsonb NOT NULL,
	"effect" jsonb NOT NULL,
	"affixes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"from_stage_id" uuid NOT NULL,
	"to_stage_id" uuid NOT NULL,
	"passage" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stage_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"source" text,
	"count" integer DEFAULT 1 NOT NULL,
	"stats" jsonb NOT NULL,
	"effect" jsonb NOT NULL,
	"affixes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"world_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"profile" text NOT NULL,
	"environment" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "vector_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection" text NOT NULL,
	"source" text,
	"doc_type" text,
	"title" text,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(384) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worlds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_key" text NOT NULL,
	"profile" text NOT NULL,
	"campaign_setting" text NOT NULL,
	"system_rules" text NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actor_controls" ADD CONSTRAINT "actor_controls_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_controls" ADD CONSTRAINT "actor_controls_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actor_controls" ADD CONSTRAINT "actor_controls_player_id_game_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_messages" ADD CONSTRAINT "agent_memory_messages_memory_id_agent_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."agent_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_messages" ADD CONSTRAINT "game_messages_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_messages" ADD CONSTRAINT "game_messages_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_messages" ADD CONSTRAINT "game_messages_source_actor_id_actors_id_fk" FOREIGN KEY ("source_actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_messages" ADD CONSTRAINT "game_messages_target_actor_id_actors_id_fk" FOREIGN KEY ("target_actor_id") REFERENCES "public"."actors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_connections" ADD CONSTRAINT "stage_connections_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_connections" ADD CONSTRAINT "stage_connections_from_stage_id_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_connections" ADD CONSTRAINT "stage_connections_to_stage_id_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_items" ADD CONSTRAINT "stage_items_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worlds" ADD CONSTRAINT "worlds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memories_game_owner_unique" ON "agent_memories" USING btree ("game_id","owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memory_messages_memory_sequence_unique" ON "agent_memory_messages" USING btree ("memory_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "game_messages_game_sequence_unique" ON "game_messages" USING btree ("game_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "game_players_game_unique" ON "game_players" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_owner_slug_unique" ON "games" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "items_actor_name_unique" ON "items" USING btree ("actor_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_connections_world_edge_unique" ON "stage_connections" USING btree ("world_id","from_stage_id","to_stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_items_stage_name_unique" ON "stage_items" USING btree ("stage_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_world_name_unique" ON "stages" USING btree ("world_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "vector_documents_collection_hash_unique" ON "vector_documents" USING btree ("collection","content_hash");--> statement-breakpoint
CREATE INDEX "vector_documents_collection_idx" ON "vector_documents" USING btree ("collection");--> statement-breakpoint
CREATE INDEX "vector_documents_collection_model_idx" ON "vector_documents" USING btree ("collection","embedding_model");--> statement-breakpoint
CREATE INDEX "vector_documents_embedding_hnsw" ON "vector_documents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "worlds_game_unique" ON "worlds" USING btree ("game_id");