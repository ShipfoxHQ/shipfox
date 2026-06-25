ALTER TABLE "workflows_step_attempts" ADD COLUMN "log_outcome" text;--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD CONSTRAINT "workflows_step_attempts_log_outcome_ck" CHECK ("workflows_step_attempts"."log_outcome" IS NULL OR "workflows_step_attempts"."log_outcome" IN ('drained', 'abandoned'));
