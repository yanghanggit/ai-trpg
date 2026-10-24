ALTER TABLE "items" ALTER COLUMN "stats" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stage_items" ALTER COLUMN "stats" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "hp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ALTER COLUMN "hp" DROP DEFAULT;
