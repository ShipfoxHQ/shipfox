UPDATE "runners_running_jobs"
SET "renewable_inference" = false
WHERE "renewable_inference" IS NULL;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ALTER COLUMN "renewable_inference" SET NOT NULL;