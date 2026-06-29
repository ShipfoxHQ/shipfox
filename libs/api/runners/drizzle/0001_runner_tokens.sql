CREATE TYPE "public"."runners_runner_session_scope" AS ENUM('workspace');
--> statement-breakpoint
CREATE TYPE "public"."runners_runner_session_registration_token_kind" AS ENUM('manual', 'ephemeral');
--> statement-breakpoint
CREATE TABLE "runners_runner_tokens" (
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
CREATE TABLE "runners_runner_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" "runners_runner_session_scope" DEFAULT 'workspace' NOT NULL,
	"registration_token_id" uuid NOT NULL,
	"registration_token_kind" "runners_runner_session_registration_token_kind" NOT NULL,
	"provisioner_id" uuid,
	"provisioned_runner_id" text,
	"labels" text[] NOT NULL,
	"max_claims" integer,
	"claims_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runners_runner_sessions_claims_ck" CHECK ("runners_runner_sessions"."claims_used" >= 0 AND (("runners_runner_sessions"."registration_token_kind" = 'manual' AND "runners_runner_sessions"."max_claims" IS NULL) OR ("runners_runner_sessions"."registration_token_kind" = 'ephemeral' AND "runners_runner_sessions"."max_claims" IS NOT NULL AND "runners_runner_sessions"."max_claims" > 0 AND "runners_runner_sessions"."claims_used" <= "runners_runner_sessions"."max_claims"))),
	CONSTRAINT "runners_runner_sessions_link_ck" CHECK (("runners_runner_sessions"."registration_token_kind" = 'manual' AND "runners_runner_sessions"."provisioner_id" IS NULL AND "runners_runner_sessions"."provisioned_runner_id" IS NULL) OR ("runners_runner_sessions"."registration_token_kind" = 'ephemeral' AND "runners_runner_sessions"."provisioner_id" IS NOT NULL AND "runners_runner_sessions"."provisioned_runner_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ADD COLUMN "runner_session_id" uuid DEFAULT uuidv7() NOT NULL;--> statement-breakpoint
ALTER TABLE "runners_running_jobs" DROP COLUMN "runner_token";--> statement-breakpoint
ALTER TABLE "runners_running_jobs" ALTER COLUMN "runner_session_id" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "runners_pending_jobs_workspace_created_idx" ON "runners_pending_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_ephemeral_registration_tokens_hashed_token_unique" ON "runners_ephemeral_registration_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "runners_ephemeral_registration_tokens_workspace_id_idx" ON "runners_ephemeral_registration_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runners_ephemeral_registration_tokens_provisioner_id_idx" ON "runners_ephemeral_registration_tokens" USING btree ("provisioner_id");--> statement-breakpoint
CREATE INDEX "runners_ephemeral_registration_tokens_active_provisioned_runner_idx" ON "runners_ephemeral_registration_tokens" USING btree ("workspace_id","provisioner_id","provisioned_runner_id","consumed_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runners_runner_tokens_hashed_token_unique" ON "runners_runner_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "runners_runner_tokens_workspace_id_idx" ON "runners_runner_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "runners_runner_tokens_active_lookup_idx" ON "runners_runner_tokens" USING btree ("hashed_token","revoked_at","expires_at");
