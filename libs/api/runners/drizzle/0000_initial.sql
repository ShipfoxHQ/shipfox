CREATE TABLE "runners_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"next_dispatch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_dispatch_error" jsonb,
	"last_dispatch_failed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runners_pending_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_pending_jobs_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "runners_running_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"runner_token" text NOT NULL,
	"provisioner_id" uuid,
	"provisioned_runner_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	CONSTRAINT "runners_running_jobs_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "runners_running_jobs_link_ck" CHECK (("runners_running_jobs"."provisioner_id" IS NULL) = ("runners_running_jobs"."provisioned_runner_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "runners_outbox_pending_idx" ON "runners_outbox" USING btree ("next_dispatch_at","created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "runners_outbox_dispatched_retention_idx" ON "runners_outbox" USING btree ("dispatched_at","id") WHERE "dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runners_pending_jobs_created_idx" ON "runners_pending_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runners_running_jobs_last_heartbeat_at_idx" ON "runners_running_jobs" USING btree ("last_heartbeat_at");
