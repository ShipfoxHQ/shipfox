UPDATE "runners_runner_sessions"
SET "tool_capabilities" = jsonb_set(
	COALESCE("tool_capabilities", '{"harnesses":{}}'::jsonb),
	'{features}',
	'{"renewable_git":false,"renewable_inference":false}'::jsonb
		|| COALESCE("tool_capabilities"->'features', '{}'::jsonb)
)
WHERE "tool_capabilities" IS NULL
	OR "tool_capabilities"->'features' IS NULL
	OR "tool_capabilities"->'features'->'renewable_git' IS NULL
	OR "tool_capabilities"->'features'->'renewable_inference' IS NULL;--> statement-breakpoint
UPDATE "runners_runner_sessions"
SET "lifecycle_capabilities" = '[]'::jsonb
WHERE "lifecycle_capabilities" IS NULL;--> statement-breakpoint
ALTER TABLE "runners_runner_sessions" ALTER COLUMN "tool_capabilities" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_runner_sessions" ALTER COLUMN "lifecycle_capabilities" SET NOT NULL;
