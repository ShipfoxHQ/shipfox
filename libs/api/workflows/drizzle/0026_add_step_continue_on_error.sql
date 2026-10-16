ALTER TYPE "public"."workflows_step_status_reason" ADD VALUE 'failure_ignored';--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD COLUMN "failure_ignored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD COLUMN "continue_on_error" boolean DEFAULT false NOT NULL;