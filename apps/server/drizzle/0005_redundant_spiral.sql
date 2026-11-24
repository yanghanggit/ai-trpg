CREATE TABLE "action_order_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"agility" integer NOT NULL,
	"actions_taken" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "action_order_entries" ADD CONSTRAINT "action_order_entries_order_id_action_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."action_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_order_entries" ADD CONSTRAINT "action_order_entries_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_orders" ADD CONSTRAINT "action_orders_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_order_entries_order_actor_unique" ON "action_order_entries" USING btree ("order_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_order_entries_order_position_unique" ON "action_order_entries" USING btree ("order_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "action_orders_game_active_unique" ON "action_orders" USING btree ("game_id") WHERE "action_orders"."status" = 'active';