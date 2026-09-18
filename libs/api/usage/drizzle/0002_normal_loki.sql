ALTER TABLE "usage_inference_segments" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ADD COLUMN "workflow_name" text;--> statement-breakpoint
ALTER TABLE "usage_job_executions" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_job_executions" ADD COLUMN "workflow_name" text;