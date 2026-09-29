ALTER TABLE "workflows_job_executions" ADD COLUMN "duration_limits" jsonb;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "duration_capped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "duration_notice" jsonb;