ALTER TABLE "auth_impersonation_windows" ALTER COLUMN "target_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_impersonation_windows" ADD COLUMN "workspace_id" uuid;