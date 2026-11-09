ALTER TABLE "items" ALTER COLUMN "affixes" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "stage_items" ALTER COLUMN "affixes" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "effect";--> statement-breakpoint
ALTER TABLE "stage_items" DROP COLUMN "effect";