DROP INDEX "projects_source_unique";--> statement-breakpoint
DROP INDEX "projects_workspace_slug_unique";--> statement-breakpoint
ALTER TABLE "projects_projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects_projects" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_source_unique" ON "projects_projects" USING btree ("source_connection_id","source_external_repository_id") WHERE "projects_projects"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_slug_unique" ON "projects_projects" USING btree ("workspace_id","slug") WHERE "projects_projects"."deleted_at" is null;