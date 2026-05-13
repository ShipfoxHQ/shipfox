DO $$ BEGIN
 CREATE TYPE "public"."workflows_run_trigger_source" AS ENUM('manual', 'webhook', 'schedule');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN IF NOT EXISTS "name" text DEFAULT 'Workflow run' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ADD COLUMN IF NOT EXISTS "trigger_source" "workflows_run_trigger_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ALTER COLUMN "name" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflows_workflow_runs" ALTER COLUMN "trigger_source" DROP DEFAULT;--> statement-breakpoint
DROP INDEX IF EXISTS "workflows_wr_project_status_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_wr_project_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_wr_project_status_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_wr_project_definition_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","definition_id","created_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_wr_project_trigger_created_id_idx" ON "workflows_workflow_runs" USING btree ("project_id","trigger_source","created_at","id");
