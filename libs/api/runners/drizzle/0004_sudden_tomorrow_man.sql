CREATE TYPE "public"."runners_provisioned_runner_state" AS ENUM('starting', 'running', 'stopping', 'stopped', 'failed', 'terminated');--> statement-breakpoint
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
CREATE UNIQUE INDEX "runners_provisioned_runners_workspace_provisioner_runner_unique" ON "runners_provisioned_runners" USING btree ("workspace_id","provisioner_id","provisioned_runner_id");--> statement-breakpoint
CREATE INDEX "runners_provisioned_runners_workspace_state_updated_idx" ON "runners_provisioned_runners" USING btree ("workspace_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "runners_provisioned_runners_active_template_counts_idx" ON "runners_provisioned_runners" USING btree ("workspace_id","provisioner_id","state","template_key") WHERE "state" in ('starting', 'running') and "template_key" is not null;--> statement-breakpoint
CREATE INDEX "runners_provisioned_runners_reservation_id_idx" ON "runners_provisioned_runners" USING btree ("reservation_id");
--> statement-breakpoint
CREATE TABLE "runners_provisioner_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text,
	"created_by_user_id" uuid NOT NULL,
	"revoked_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "runners_provisioner_tokens_hashed_token_unique" ON "runners_provisioner_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "runners_provisioner_tokens_workspace_id_idx" ON "runners_provisioner_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runners_provisioner_tokens_workspace_last_seen_idx" ON "runners_provisioner_tokens" USING btree ("workspace_id","last_seen_at" DESC,"id" DESC);
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
CREATE UNIQUE INDEX "runners_rate_limits_window_unique" ON "runners_rate_limits" USING btree ("action","scope","identifier_hmac","window_start");--> statement-breakpoint
CREATE INDEX "runners_rate_limits_expires_at_idx" ON "runners_rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "runners_ephemeral_registration_tokens_reservation_id_idx" ON "runners_ephemeral_registration_tokens" USING btree ("reservation_id");
