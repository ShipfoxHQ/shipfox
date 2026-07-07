CREATE TYPE "public"."annotations_style" AS ENUM('default', 'info', 'success', 'warning', 'error');--> statement-breakpoint
CREATE TABLE "annotations_annotations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workflow_run_attempt" integer NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_execution_id" uuid NOT NULL,
	"origin_step_id" uuid NOT NULL,
	"origin_step_attempt" integer NOT NULL,
	"context" text NOT NULL,
	"style" "annotations_style" DEFAULT 'default' NOT NULL,
	"body" text NOT NULL,
	"body_bytes" integer NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotations_workflow_run_attempt_positive_ck" CHECK ("annotations_annotations"."workflow_run_attempt" > 0),
	CONSTRAINT "annotations_origin_step_attempt_positive_ck" CHECK ("annotations_annotations"."origin_step_attempt" > 0),
	CONSTRAINT "annotations_body_bytes_matches_body_ck" CHECK ("annotations_annotations"."body_bytes" = octet_length("annotations_annotations"."body")),
	CONSTRAINT "annotations_sequence_positive_ck" CHECK ("annotations_annotations"."sequence" > 0),
	CONSTRAINT "annotations_context_not_empty_ck" CHECK (length("annotations_annotations"."context") > 0),
	CONSTRAINT "annotations_context_trimmed_ck" CHECK ("annotations_annotations"."context" = btrim("annotations_annotations"."context", concat(chr(9), chr(10), chr(11), chr(12), chr(13), chr(32), chr(160), chr(5760), chr(8192), chr(8193), chr(8194), chr(8195), chr(8196), chr(8197), chr(8198), chr(8199), chr(8200), chr(8201), chr(8202), chr(8232), chr(8233), chr(8239), chr(8287), chr(12288), chr(65279)))),
	CONSTRAINT "annotations_context_max_length_ck" CHECK (length("annotations_annotations"."context") <= 255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "annotations_job_execution_context_unique" ON "annotations_annotations" USING btree ("job_execution_id","context");--> statement-breakpoint
CREATE INDEX "annotations_workflow_run_attempt_idx" ON "annotations_annotations" USING btree ("workflow_run_id","workflow_run_attempt");--> statement-breakpoint
CREATE INDEX "annotations_workflow_run_attempt_id_idx" ON "annotations_annotations" USING btree ("workflow_run_attempt_id");--> statement-breakpoint
CREATE INDEX "annotations_job_execution_id_idx" ON "annotations_annotations" USING btree ("job_execution_id");
