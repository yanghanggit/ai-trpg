ALTER TABLE "items" ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;