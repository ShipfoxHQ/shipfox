ALTER TABLE "workflows_step_attempts" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD COLUMN "background" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD COLUMN "parallel_group" text;--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD COLUMN "joined_at" integer;