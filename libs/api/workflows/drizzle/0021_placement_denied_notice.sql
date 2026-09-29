ALTER TYPE "public"."workflows_job_status_reason" ADD VALUE 'runner_not_allowed';--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "status_reason_notice" jsonb;