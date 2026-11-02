ALTER TABLE "integrations_managed_vcs_repositories" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations_managed_vcs_repositories" ADD COLUMN "link_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations_managed_vcs_repositories" ADD COLUMN "link_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations_managed_vcs_repositories" ADD COLUMN "link_external_repository_id" text;--> statement-breakpoint
ALTER TABLE "integrations_managed_vcs_repositories" ADD COLUMN "link_started_by" text;--> statement-breakpoint
ALTER TABLE "integrations_managed_vcs_repositories" ADD COLUMN "link_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrations_managed_vcs_repositories" ADD COLUMN "pull_request_url" text;--> statement-breakpoint
ALTER TABLE "integrations_managed_vcs_repositories" ADD COLUMN "pull_request_number" integer;