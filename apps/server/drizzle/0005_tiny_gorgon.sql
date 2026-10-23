ALTER TABLE "items" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "use" jsonb;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "use" jsonb;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "key" text;