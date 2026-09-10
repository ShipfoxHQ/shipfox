ALTER TYPE "public"."workflows_job_status_reason" ADD VALUE 'lease_expired' BEFORE 'runner_lost';--> statement-breakpoint
ALTER TYPE "public"."workflows_job_status_reason" ADD VALUE 'provider_lost' BEFORE 'runner_lost';--> statement-breakpoint
ALTER TYPE "public"."workflows_job_status_reason" ADD VALUE 'lifecycle_violation' BEFORE 'runner_lost';
