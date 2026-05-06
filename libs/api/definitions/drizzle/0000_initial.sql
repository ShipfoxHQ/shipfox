CREATE TYPE "public"."definitions_source" AS ENUM('manual', 'vcs');--> statement-breakpoint
CREATE TYPE "public"."definitions_sync_error_code" AS ENUM('no-workflow-files', 'invalid-definition', 'provider-repository-not-found', 'provider-file-not-found', 'provider-access-denied', 'provider-rate-limited', 'provider-timeout', 'provider-unavailable', 'provider-malformed-response', 'content-too-large', 'too-many-files', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."definitions_sync_status" AS ENUM('pending', 'syncing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "definitions_workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"config_path" text,
	"source" "definitions_source" DEFAULT 'manual' NOT NULL,
	"sha" text,
	"ref" text,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "definitions_sync_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"source_external_repository_id" text NOT NULL,
	"ref" text NOT NULL,
	"status" "definitions_sync_status" DEFAULT 'pending' NOT NULL,
	"last_error_code" "definitions_sync_error_code",
	"last_error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "definitions_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_wd_project_id_config_path_unique" ON "definitions_workflow_definitions" USING btree ("project_id","config_path") WHERE "config_path" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_wd_sha_lookup" ON "definitions_workflow_definitions" USING btree ("project_id","sha","config_path") WHERE "sha" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_wd_ref_lookup" ON "definitions_workflow_definitions" USING btree ("project_id","ref","config_path") WHERE "ref" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_sync_states_source_unique" ON "definitions_sync_states" USING btree ("project_id","source_connection_id","source_external_repository_id","ref");
--> statement-breakpoint
CREATE INDEX "definitions_outbox_pending_idx" ON "definitions_outbox" USING btree ("created_at") WHERE "dispatched_at" IS NULL;
