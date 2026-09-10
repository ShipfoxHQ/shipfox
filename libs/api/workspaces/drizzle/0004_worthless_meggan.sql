ALTER TABLE "workspaces_memberships" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
CREATE INDEX "workspaces_memberships_workspace_created_id_idx" ON "workspaces_memberships" USING btree ("workspace_id","created_at","id");
