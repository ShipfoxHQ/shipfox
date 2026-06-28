ALTER TABLE "runners_pending_jobs" ADD COLUMN "required_labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_pending_jobs" ALTER COLUMN "required_labels" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD COLUMN "required_labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ALTER COLUMN "required_labels" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD COLUMN "runner_labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ALTER COLUMN "runner_labels" DROP DEFAULT;
