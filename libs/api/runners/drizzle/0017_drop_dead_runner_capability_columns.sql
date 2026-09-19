ALTER TABLE "runners_runner_instances" DROP COLUMN "capabilities";--> statement-breakpoint
ALTER TABLE "runners_runner_sessions" DROP COLUMN "tool_capabilities_reported_at";--> statement-breakpoint
ALTER TABLE "runners_runner_sessions" DROP COLUMN "lifecycle_capabilities_reported_at";