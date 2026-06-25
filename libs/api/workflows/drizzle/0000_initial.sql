CREATE TYPE "public"."workflows_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."workflows_step_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflows_run_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "workflows_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "workflows_job_status" DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"dependencies" jsonb NOT NULL,
	"runner" jsonb,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timed_out_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows_outbox" (
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
CREATE TABLE "workflows_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text,
	"display_name" text NOT NULL,
	"status" "workflows_step_status" DEFAULT 'pending' NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "workflows_run_status" DEFAULT 'pending' NOT NULL,
	"trigger_source" text NOT NULL,
	"trigger_event" text NOT NULL,
	"trigger_payload" jsonb NOT NULL,
	"inputs" jsonb,
	"trigger_idempotency_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workflows_jobs" ADD CONSTRAINT "workflows_jobs_run_id_workflows_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflows_workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD CONSTRAINT "workflows_steps_job_id_workflows_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."workflows_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_jobs_run_id_idx" ON "workflows_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "workflows_outbox_pending_idx" ON "workflows_outbox" USING btree ("next_dispatch_at","created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "workflows_outbox_dispatched_retention_idx" ON "workflows_outbox" USING btree ("dispatched_at","id") WHERE "dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflows_steps_job_id_idx" ON "workflows_steps" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wr_trigger_idempotency_key_unique" ON "workflows_workflow_runs" USING btree ("trigger_idempotency_key");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_status_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_definition_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","definition_id","created_at","id");--> statement-breakpoint
CREATE INDEX "workflows_wr_project_trigger_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","trigger_source","created_at","id");
