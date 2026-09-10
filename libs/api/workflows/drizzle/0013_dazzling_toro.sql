CREATE TYPE "public"."workflows_concurrency_claim_state" AS ENUM('acquired', 'waiting', 'superseded', 'released');--> statement-breakpoint
CREATE TYPE "public"."workflows_concurrency_scope" AS ENUM('workflow', 'project');--> statement-breakpoint
CREATE TABLE "workflows_workflow_concurrency_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"origin_scope" text NOT NULL,
	"scope" "workflows_concurrency_scope" NOT NULL,
	"definition_id" uuid,
	"display_group" text NOT NULL,
	"canonical_group_key" text NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"cancel_in_progress" boolean NOT NULL,
	"state" "workflows_concurrency_claim_state" NOT NULL,
	"superseded_by_claim_id" uuid,
	"cancellation_requested_at" timestamp with time zone,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acquired_at" timestamp with time zone,
	"waiting_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_wcc_generation_positive_ck" CHECK ("workflows_workflow_concurrency_claims"."generation" > 0),
	CONSTRAINT "workflows_wcc_display_group_bytes_ck" CHECK (octet_length("workflows_workflow_concurrency_claims"."display_group") between 1 and 256),
	CONSTRAINT "workflows_wcc_scope_definition_ck" CHECK ((
        ("workflows_workflow_concurrency_claims"."scope" = 'workflow' and "workflows_workflow_concurrency_claims"."definition_id" is not null)
        or ("workflows_workflow_concurrency_claims"."scope" = 'project' and "workflows_workflow_concurrency_claims"."definition_id" is null)
      )),
	CONSTRAINT "workflows_wcc_state_timestamps_ck" CHECK ((
        ("workflows_workflow_concurrency_claims"."state" = 'acquired' and "workflows_workflow_concurrency_claims"."acquired_at" is not null)
        or ("workflows_workflow_concurrency_claims"."state" = 'waiting' and "workflows_workflow_concurrency_claims"."waiting_at" is not null)
        or (
          "workflows_workflow_concurrency_claims"."state" = 'superseded'
          and "workflows_workflow_concurrency_claims"."superseded_at" is not null
          and "workflows_workflow_concurrency_claims"."superseded_by_claim_id" is not null
        )
        or ("workflows_workflow_concurrency_claims"."state" = 'released' and "workflows_workflow_concurrency_claims"."released_at" is not null)
      )),
	CONSTRAINT "workflows_wcc_origin_scope_nonempty_ck" CHECK (length("workflows_workflow_concurrency_claims"."origin_scope") > 0)
);
--> statement-breakpoint
ALTER TABLE "workflows_workflow_concurrency_claims" ADD CONSTRAINT "workflows_workflow_concurrency_claims_workflow_run_id_workflows_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflows_workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_workflow_concurrency_claims" ADD CONSTRAINT "workflows_workflow_concurrency_claims_workflow_run_attempt_id_workflows_workflow_run_attempts_id_fk" FOREIGN KEY ("workflow_run_attempt_id") REFERENCES "public"."workflows_workflow_run_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wcc_workflow_run_attempt_unique" ON "workflows_workflow_concurrency_claims" USING btree ("workflow_run_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wcc_workflow_generation_unique" ON "workflows_workflow_concurrency_claims" USING btree ("project_id","origin_scope","definition_id","canonical_group_key","generation") WHERE "workflows_workflow_concurrency_claims"."scope" = 'workflow';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wcc_project_generation_unique" ON "workflows_workflow_concurrency_claims" USING btree ("project_id","origin_scope","canonical_group_key","generation") WHERE "workflows_workflow_concurrency_claims"."scope" = 'project';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wcc_workflow_acquired_unique" ON "workflows_workflow_concurrency_claims" USING btree ("project_id","origin_scope","definition_id","canonical_group_key") WHERE "workflows_workflow_concurrency_claims"."scope" = 'workflow' and "workflows_workflow_concurrency_claims"."state" = 'acquired';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wcc_project_acquired_unique" ON "workflows_workflow_concurrency_claims" USING btree ("project_id","origin_scope","canonical_group_key") WHERE "workflows_workflow_concurrency_claims"."scope" = 'project' and "workflows_workflow_concurrency_claims"."state" = 'acquired';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wcc_workflow_waiting_unique" ON "workflows_workflow_concurrency_claims" USING btree ("project_id","origin_scope","definition_id","canonical_group_key") WHERE "workflows_workflow_concurrency_claims"."scope" = 'workflow' and "workflows_workflow_concurrency_claims"."state" = 'waiting';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_wcc_project_waiting_unique" ON "workflows_workflow_concurrency_claims" USING btree ("project_id","origin_scope","canonical_group_key") WHERE "workflows_workflow_concurrency_claims"."scope" = 'project' and "workflows_workflow_concurrency_claims"."state" = 'waiting';--> statement-breakpoint
CREATE INDEX "workflows_wcc_project_created_id_idx" ON "workflows_workflow_concurrency_claims" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE INDEX "workflows_wcc_workflow_run_id_idx" ON "workflows_workflow_concurrency_claims" USING btree ("workflow_run_id");