CREATE TABLE "logs_deleted_scopes" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "logs_deleted_scopes_scope_unique" UNIQUE NULLS NOT DISTINCT("workspace_id","project_id")
);
--> statement-breakpoint
CREATE INDEX "logs_attempt_streams_project_idx" ON "logs_attempt_streams" USING btree ("project_id");
