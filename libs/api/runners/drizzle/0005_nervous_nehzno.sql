ALTER TABLE "runners_pending_jobs" ADD COLUMN "workflow_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD COLUMN "workflow_run_id" uuid;--> statement-breakpoint
DO $$
BEGIN
	IF to_regclass('public.workflows_workflow_run_attempts') IS NOT NULL THEN
		UPDATE "runners_pending_jobs"
		SET "workflow_run_id" = "workflows_workflow_run_attempts"."workflow_run_id"
		FROM "workflows_workflow_run_attempts"
		WHERE "runners_pending_jobs"."workflow_run_id" IS NULL
			AND "runners_pending_jobs"."workflow_run_attempt_id" = "workflows_workflow_run_attempts"."id";

		UPDATE "runners_running_jobs"
		SET "workflow_run_id" = "workflows_workflow_run_attempts"."workflow_run_id"
		FROM "workflows_workflow_run_attempts"
		WHERE "runners_running_jobs"."workflow_run_id" IS NULL
			AND "runners_running_jobs"."workflow_run_attempt_id" = "workflows_workflow_run_attempts"."id";
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "runners_pending_jobs" ALTER COLUMN "workflow_run_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ALTER COLUMN "workflow_run_id" SET NOT NULL;
