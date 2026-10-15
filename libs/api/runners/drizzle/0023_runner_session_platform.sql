ALTER TABLE "runners_runner_sessions" ADD COLUMN "os" text DEFAULT 'linux' NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_runner_sessions" ADD COLUMN "arch" text DEFAULT 'x64' NOT NULL;
