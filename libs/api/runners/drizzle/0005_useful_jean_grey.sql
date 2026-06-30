ALTER TABLE "runners_pending_jobs" DROP CONSTRAINT "runners_pending_jobs_job_id_unique";--> statement-breakpoint
ALTER TABLE "runners_running_jobs" DROP CONSTRAINT "runners_running_jobs_job_id_unique";--> statement-breakpoint
ALTER TABLE "runners_pending_jobs" ADD COLUMN "execution_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD COLUMN "execution_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "runners_pending_jobs_job_id_idx" ON "runners_pending_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "runners_running_jobs_job_id_idx" ON "runners_running_jobs" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "runners_pending_jobs" ADD CONSTRAINT "runners_pending_jobs_execution_id_unique" UNIQUE("execution_id");--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD CONSTRAINT "runners_running_jobs_execution_id_unique" UNIQUE("execution_id");