CREATE TYPE "public"."workflows_rerun_mode" AS ENUM('all', 'failed');--> statement-breakpoint
ALTER TABLE "workflows_jobs" ADD COLUMN "carried_over" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "source_run_id" uuid REFERENCES "public"."workflows_workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "root_run_id" uuid REFERENCES "public"."workflows_workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "rerun_mode" "workflows_rerun_mode";--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "rerun_by_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wr_root_run_attempt_unique" ON "workflows_workflow_runs" USING btree ("root_run_id","attempt") WHERE "workflows_workflow_runs"."root_run_id" is not null;
