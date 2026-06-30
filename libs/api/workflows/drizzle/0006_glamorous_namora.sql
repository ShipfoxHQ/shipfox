CREATE TYPE "public"."workflows_job_execution_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "workflows_job_executions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"status" "workflows_job_execution_status" DEFAULT 'pending' NOT NULL,
	"status_reason" "workflows_job_status_reason",
	"trigger_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"timed_out_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" DROP CONSTRAINT "workflows_step_attempts_job_id_execution_order_uq";--> statement-breakpoint
ALTER TABLE "workflows_jobs" ADD COLUMN "success" text;--> statement-breakpoint
ALTER TABLE "workflows_jobs" ADD COLUMN "execution_timeout_ms" integer;--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD COLUMN "execution_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD COLUMN "execution_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD CONSTRAINT "workflows_job_executions_job_id_workflows_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."workflows_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD CONSTRAINT "workflows_job_executions_run_id_workflows_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflows_workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "workflows_job_executions" (
	"job_id",
	"run_id",
	"sequence",
	"name",
	"status",
	"status_reason",
	"version",
	"created_at",
	"updated_at",
	"queued_at",
	"started_at",
	"finished_at",
	"timed_out_at"
)
SELECT
	"id",
	"run_id",
	1,
	"name",
	CASE
		WHEN "status" = 'skipped' THEN 'cancelled'::"workflows_job_execution_status"
		ELSE "status"::text::"workflows_job_execution_status"
	END,
	"status_reason",
	"version",
	"created_at",
	"updated_at",
	"queued_at",
	"started_at",
	"finished_at",
	"timed_out_at"
FROM "workflows_jobs";--> statement-breakpoint
UPDATE "workflows_steps"
SET "execution_id" = "workflows_job_executions"."id"
FROM "workflows_job_executions"
WHERE "workflows_steps"."job_id" = "workflows_job_executions"."job_id";--> statement-breakpoint
UPDATE "workflows_step_attempts"
SET "execution_id" = "workflows_job_executions"."id"
FROM "workflows_job_executions"
WHERE "workflows_step_attempts"."job_id" = "workflows_job_executions"."job_id";--> statement-breakpoint
ALTER TABLE "workflows_steps" ALTER COLUMN "execution_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ALTER COLUMN "execution_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "workflows_job_executions_job_id_idx" ON "workflows_job_executions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "workflows_job_executions_run_id_idx" ON "workflows_job_executions" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD CONSTRAINT "workflows_step_attempts_execution_id_workflows_job_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflows_job_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD CONSTRAINT "workflows_steps_execution_id_workflows_job_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflows_job_executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_step_attempts_execution_id_idx" ON "workflows_step_attempts" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "workflows_steps_execution_id_idx" ON "workflows_steps" USING btree ("execution_id");--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD CONSTRAINT "workflows_step_attempts_execution_id_execution_order_uq" UNIQUE("execution_id","execution_order");
