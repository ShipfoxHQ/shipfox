ALTER TYPE "public"."workflows_step_status_reason" ADD VALUE 'composite_skipped' BEFORE 'timed_out';--> statement-breakpoint
ALTER TABLE "workflows_job_executions" ADD COLUMN "actions_dir" text;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD COLUMN "parent_step_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD CONSTRAINT "workflows_steps_parent_step_id_workflows_steps_id_fk" FOREIGN KEY ("parent_step_id") REFERENCES "public"."workflows_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_steps_parent_step_id_idx" ON "workflows_steps" USING btree ("parent_step_id");