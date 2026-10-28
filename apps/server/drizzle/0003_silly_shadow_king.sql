CREATE TABLE "actor_presentations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"actor_id" uuid NOT NULL,
	"anchor" text NOT NULL,
	"appearance" text NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "key" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "actors" ALTER COLUMN "key" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "actors" DROP COLUMN "appearance";--> statement-breakpoint
ALTER TABLE "actor_presentations" ADD CONSTRAINT "actor_presentations_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actor_presentations_actor_idx" ON "actor_presentations" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actor_presentations_current_unique" ON "actor_presentations" USING btree ("actor_id") WHERE "actor_presentations"."ended_at" is null;
