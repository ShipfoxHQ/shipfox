ALTER TYPE "public"."workflows_run_status" ADD VALUE 'waiting' BEFORE 'pending';--> statement-breakpoint
DROP INDEX "workflows_wra_one_active_attempt_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wra_one_active_attempt_unique" ON "workflows_workflow_run_attempts" USING btree ("workflow_run_id") WHERE "workflows_workflow_run_attempts"."status" not in ('succeeded', 'failed', 'cancelled');
