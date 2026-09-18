ALTER TABLE "workflows_workflow_runs" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "root_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "workflows_wr_root_run_id_idx" ON "workflows_workflow_runs" USING btree ("root_run_id") WHERE "workflows_workflow_runs"."root_run_id" is not null;