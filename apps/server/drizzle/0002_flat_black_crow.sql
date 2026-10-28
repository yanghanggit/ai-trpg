CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"serialization_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"result" jsonb,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","status","run_at","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_created_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_kind_idx" ON "jobs" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_serialization_unique" ON "jobs" USING btree ("queue","serialization_key") WHERE "jobs"."serialization_key" is not null and "jobs"."status" in ('pending', 'running');