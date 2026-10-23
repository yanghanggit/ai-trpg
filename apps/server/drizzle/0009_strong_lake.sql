ALTER TABLE "items" ADD COLUMN "affixes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "affixes" jsonb DEFAULT '[]'::jsonb NOT NULL;