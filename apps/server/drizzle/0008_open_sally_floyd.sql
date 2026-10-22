ALTER TABLE "actors" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "actors" ADD COLUMN "status_effects" jsonb DEFAULT '[]'::jsonb NOT NULL;