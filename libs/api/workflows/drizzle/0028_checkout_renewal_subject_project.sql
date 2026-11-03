ALTER TABLE "workflows_checkout_renewal_subjects" ADD COLUMN "project_id" uuid;--> statement-breakpoint
UPDATE "workflows_checkout_renewal_subjects" AS "subject" SET "project_id" = "run"."project_id" FROM "workflows_workflow_run_attempts" AS "attempt" INNER JOIN "workflows_workflow_runs" AS "run" ON "run"."id" = "attempt"."workflow_run_id" WHERE "attempt"."id" = "subject"."workflow_run_attempt_id";--> statement-breakpoint
ALTER TABLE "workflows_checkout_renewal_subjects" ALTER COLUMN "project_id" SET NOT NULL;
