ALTER TABLE "triggers_job_listener_subscriptions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "triggers_received_events" ADD COLUMN "resource" jsonb;--> statement-breakpoint
CREATE INDEX "triggers_job_listener_subscriptions_project_idx" ON "triggers_job_listener_subscriptions" USING btree ("project_id");