UPDATE "runners_runner_sessions"
SET "tool_capabilities" = '{"features":{"renewable_git":false,"renewable_inference":false},"harnesses":{}}'::jsonb
WHERE "tool_capabilities" IS NULL;--> statement-breakpoint
UPDATE "runners_runner_sessions"
SET "lifecycle_capabilities" = '[]'::jsonb
WHERE "lifecycle_capabilities" IS NULL;--> statement-breakpoint
ALTER TABLE "runners_runner_sessions" ALTER COLUMN "tool_capabilities" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_runner_sessions" ALTER COLUMN "lifecycle_capabilities" SET NOT NULL;
