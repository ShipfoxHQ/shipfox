CREATE TYPE "public"."workspace_role" AS ENUM('admin');--> statement-breakpoint
ALTER TABLE "workspaces_memberships" ADD COLUMN "role" "workspace_role" DEFAULT 'admin' NOT NULL;
