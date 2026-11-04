CREATE TABLE "agent_deleted_scopes" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "agent_deleted_scopes_scope_unique" UNIQUE NULLS NOT DISTINCT("workspace_id","project_id")
);
--> statement-breakpoint
CREATE INDEX "agent_sessions_project_idx" ON "agent_sessions" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "agent_conversations_project_idx" ON "agent_conversations" USING btree ("project_id");