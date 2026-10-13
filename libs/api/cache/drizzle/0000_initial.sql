CREATE TABLE "cache_deletions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"reason" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cache_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"upload_id" text,
	"created_by_run_id" uuid NOT NULL,
	"created_by_job_execution_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cache_workspace_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"retention_days" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cache_deletions_workspace_deleted_at_idx" ON "cache_deletions" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cache_entries_identity_unique" ON "cache_entries" USING btree ("project_id","scope","key","version");--> statement-breakpoint
CREATE INDEX "cache_entries_prefix_lookup_idx" ON "cache_entries" USING btree ("project_id","scope","version","key" text_pattern_ops,"committed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cache_entries_workspace_last_accessed_idx" ON "cache_entries" USING btree ("workspace_id","last_accessed_at");