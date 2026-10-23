UPDATE "items" SET "effect" = CASE WHEN "kind" = 'weapon' THEN '{"type":"damage"}'::jsonb ELSE '{"type":"event"}'::jsonb END WHERE "effect" IS NULL;--> statement-breakpoint
UPDATE "stage_items" SET "effect" = CASE WHEN "kind" = 'weapon' THEN '{"type":"damage"}'::jsonb ELSE '{"type":"event"}'::jsonb END WHERE "effect" IS NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "effect" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stage_items" ALTER COLUMN "effect" SET NOT NULL;