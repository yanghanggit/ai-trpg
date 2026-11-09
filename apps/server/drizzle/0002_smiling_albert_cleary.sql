ALTER TABLE "items" ADD COLUMN "max_targets" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "max_targets" integer DEFAULT 1 NOT NULL;