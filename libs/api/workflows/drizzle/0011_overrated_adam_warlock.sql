ALTER TYPE "public"."workflows_step_status_reason" ADD VALUE 'timed_out';--> statement-breakpoint
ALTER TYPE "public"."workflows_step_status_reason" ADD VALUE 'run_cancelled';--> statement-breakpoint
ALTER TYPE "public"."workflows_step_status_reason" ADD VALUE 'runner_lost';