CREATE TABLE "runners_deleted_scopes" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "runners_deleted_scopes_scope_unique" UNIQUE NULLS NOT DISTINCT("workspace_id","project_id")
);
--> statement-breakpoint
CREATE INDEX "runners_pending_jobs_project_idx" ON "runners_pending_jobs" USING btree ("project_id");
