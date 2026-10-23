ALTER TABLE "worlds" ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "use";--> statement-breakpoint
ALTER TABLE "stage_items" DROP COLUMN "use";