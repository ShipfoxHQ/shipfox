ALTER TABLE "agent_conversation_run_links" ADD COLUMN "latest_attempt_id" uuid;--> statement-breakpoint
-- Existing links have no attempt yet. A requested check lets the recovery sweep record it.
UPDATE "agent_conversation_run_links" SET "check_requested_at" = now() WHERE "check_requested_at" IS NULL;
