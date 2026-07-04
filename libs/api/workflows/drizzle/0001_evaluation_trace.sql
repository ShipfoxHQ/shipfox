ALTER TABLE "workflows_job_executions" ADD COLUMN "evaluation_trace" jsonb;--> statement-breakpoint
ALTER TABLE "workflows_jobs" ADD COLUMN "evaluation_trace" jsonb;--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD COLUMN "evaluation_trace" jsonb;
