CREATE TYPE "public"."runners_provisioned_runner_state" AS ENUM('starting', 'running', 'stopping', 'stopped', 'failed', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."runners_provisioner_scope" AS ENUM('workspace', 'installation');--> statement-breakpoint
CREATE TYPE "public"."runners_runner_session_registration_token_kind" AS ENUM('manual', 'ephemeral');--> statement-breakpoint
CREATE TYPE "public"."runners_runner_session_scope" AS ENUM('workspace');--> statement-breakpoint
CREATE TABLE "runners_ephemeral_registration_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provisioner_id" uuid NOT NULL,
	"reservation_id" uuid,
	"provisioned_runner_id" text NOT NULL,
	"hashed_token" text NOT NULL,
	"prefix" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners_manual_registration_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"ordering_key" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"next_dispatch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_dispatch_error" jsonb,
	"last_dispatch_failed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runners_pending_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_execution_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"required_labels" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_pending_jobs_job_execution_id_unique" UNIQUE("job_execution_id")
);
--> statement-breakpoint
CREATE TABLE "runners_provisioned_runners" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provisioner_id" uuid NOT NULL,
	"provisioned_runner_id" text NOT NULL,
	"reservation_id" uuid,
	"template_key" text,
	"labels" text[] NOT NULL,
	"state" "runners_provisioned_runner_state" NOT NULL,
	"reason" text,
	"runner_session_id" uuid,
	"provider_kind" text,
	"reported_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"stopping_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"reservation_released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners_provisioner_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scope" "runners_provisioner_scope" NOT NULL,
	"workspace_id" uuid,
	"hashed_token" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text,
	"created_by_user_id" uuid NOT NULL,
	"revoked_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_provisioner_tokens_scope_workspace_ck" CHECK ((scope = 'workspace' AND workspace_id IS NOT NULL) OR (scope = 'installation' AND workspace_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "runners_rate_limits" (
	"action" text NOT NULL,
	"scope" text NOT NULL,
	"identifier_hmac" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provisioner_id" uuid NOT NULL,
	"required_labels" text[] NOT NULL,
	"count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runners_reservations_count_positive_ck" CHECK ("runners_reservations"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "runners_runner_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" "runners_runner_session_scope" DEFAULT 'workspace' NOT NULL,
	"registration_token_id" uuid NOT NULL,
	"registration_token_kind" "runners_runner_session_registration_token_kind" NOT NULL,
	"provisioner_id" uuid,
	"provisioned_runner_id" text,
	"labels" text[] NOT NULL,
	"tool_capabilities" jsonb,
	"tool_capabilities_reported_at" timestamp with time zone,
	"max_claims" integer,
	"claims_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_runner_sessions_claims_ck" CHECK ("runners_runner_sessions"."claims_used" >= 0 AND (("runners_runner_sessions"."registration_token_kind" = 'manual' AND "runners_runner_sessions"."max_claims" IS NULL) OR ("runners_runner_sessions"."registration_token_kind" = 'ephemeral' AND "runners_runner_sessions"."max_claims" IS NOT NULL AND "runners_runner_sessions"."max_claims" > 0 AND "runners_runner_sessions"."claims_used" <= "runners_runner_sessions"."max_claims"))),
	CONSTRAINT "runners_runner_sessions_link_ck" CHECK ((("runners_runner_sessions"."registration_token_kind" = 'manual' AND "runners_runner_sessions"."provisioner_id" IS NULL AND "runners_runner_sessions"."provisioned_runner_id" IS NULL) OR ("runners_runner_sessions"."registration_token_kind" = 'ephemeral' AND "runners_runner_sessions"."provisioner_id" IS NOT NULL AND "runners_runner_sessions"."provisioned_runner_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "runners_running_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"workflow_run_attempt_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"job_execution_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"runner_session_id" uuid NOT NULL,
	"provisioner_id" uuid,
	"provisioned_runner_id" text,
	"required_labels" text[] NOT NULL,
	"runner_labels" text[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_heartbeat_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	CONSTRAINT "runners_running_jobs_job_execution_id_unique" UNIQUE("job_execution_id"),
	CONSTRAINT "runners_running_jobs_link_ck" CHECK (("runners_running_jobs"."provisioner_id" IS NULL) = ("runners_running_jobs"."provisioned_runner_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD CONSTRAINT "runners_running_jobs_runner_session_id_runners_runner_sessions_id_fk" FOREIGN KEY ("runner_session_id") REFERENCES "public"."runners_runner_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runners_ephemeral_registration_tokens_hashed_token_unique" ON "runners_ephemeral_registration_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "runners_ephemeral_registration_tokens_reservation_id_idx" ON "runners_ephemeral_registration_tokens" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "runners_ephemeral_registration_tokens_active_provisioned_runner_idx" ON "runners_ephemeral_registration_tokens" USING btree ("workspace_id","provisioner_id","provisioned_runner_id","consumed_at","expires_at");--> statement-breakpoint
CREATE INDEX "runners_ephemeral_registration_tokens_terminal_idx" ON "runners_ephemeral_registration_tokens" USING btree (coalesce("consumed_at", "expires_at"),"id");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_manual_registration_tokens_hashed_token_unique" ON "runners_manual_registration_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "runners_manual_registration_tokens_workspace_id_idx" ON "runners_manual_registration_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runners_outbox_pending_idx" ON "runners_outbox" USING btree ("next_dispatch_at","created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runners_outbox_dispatched_retention_idx" ON "runners_outbox" USING btree ("dispatched_at","id") WHERE "dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runners_pending_jobs_workspace_created_idx" ON "runners_pending_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "runners_pending_jobs_job_id_idx" ON "runners_pending_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_provisioned_runners_workspace_provisioner_runner_unique" ON "runners_provisioned_runners" USING btree ("workspace_id","provisioner_id","provisioned_runner_id");--> statement-breakpoint
CREATE INDEX "runners_provisioned_runners_workspace_state_updated_idx" ON "runners_provisioned_runners" USING btree ("workspace_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "runners_provisioned_runners_stale_reaper_idx" ON "runners_provisioned_runners" USING btree ("state","updated_at","reported_at","workspace_id");--> statement-breakpoint
CREATE INDEX "runners_provisioned_runners_active_template_counts_idx" ON "runners_provisioned_runners" USING btree ("workspace_id","provisioner_id","state","template_key") WHERE "state" in ('starting', 'running') and "template_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "runners_provisioner_tokens_hashed_token_unique" ON "runners_provisioner_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "runners_provisioner_tokens_workspace_last_seen_idx" ON "runners_provisioner_tokens" USING btree ("workspace_id","last_seen_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "runners_rate_limits_window_unique" ON "runners_rate_limits" USING btree ("action","scope","identifier_hmac","window_start");--> statement-breakpoint
CREATE INDEX "runners_rate_limits_expires_at_idx" ON "runners_rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "runners_reservations_workspace_expires_idx" ON "runners_reservations" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "runners_reservations_expires_idx" ON "runners_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "runners_runner_sessions_kind_created_id_idx" ON "runners_runner_sessions" USING btree ("registration_token_kind","created_at","id");--> statement-breakpoint
CREATE INDEX "runners_runner_sessions_provisioned_runner_updated_idx" ON "runners_runner_sessions" USING btree ("workspace_id","provisioner_id","provisioned_runner_id","updated_at") WHERE "provisioner_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runners_running_jobs_no_first_heartbeat_started_idx" ON "runners_running_jobs" USING btree ("started_at") WHERE "first_heartbeat_at" IS NULL;--> statement-breakpoint
CREATE INDEX "runners_running_jobs_last_heartbeat_at_idx" ON "runners_running_jobs" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "runners_running_jobs_provisioned_runner_started_idx" ON "runners_running_jobs" USING btree ("workspace_id","provisioner_id","provisioned_runner_id","started_at" DESC NULLS LAST) WHERE "provisioner_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runners_running_jobs_cancellation_requested_idx" ON "runners_running_jobs" USING btree ("workspace_id","provisioner_id","provisioned_runner_id") WHERE "cancellation_requested_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runners_running_jobs_job_id_idx" ON "runners_running_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "runners_running_jobs_runner_session_id_idx" ON "runners_running_jobs" USING btree ("runner_session_id");
