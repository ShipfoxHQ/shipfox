ALTER TABLE "workflows_steps" ADD COLUMN "run_after" text DEFAULT 'success' NOT NULL;--> statement-breakpoint
UPDATE "workflows_steps" SET "run_after" = 'always' WHERE "condition" IS NOT NULL;
