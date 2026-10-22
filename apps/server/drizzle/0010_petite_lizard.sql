ALTER TABLE "items" ADD COLUMN "count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "damage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "block" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "damage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_items" ADD COLUMN "block" integer DEFAULT 0 NOT NULL;