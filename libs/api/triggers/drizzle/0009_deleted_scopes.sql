CREATE TABLE "triggers_deleted_scopes" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "triggers_deleted_scopes_scope_unique" UNIQUE NULLS NOT DISTINCT("workspace_id","project_id")
);
--> statement-breakpoint
CREATE INDEX "triggers_decisions_project_idx" ON "triggers_decisions" USING btree ("project_id");