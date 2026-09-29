ALTER TABLE "runners_pending_jobs" ADD COLUMN "wait_reason" text;--> statement-breakpoint
ALTER TABLE "runners_pending_jobs" ADD COLUMN "wait_detail" jsonb;
