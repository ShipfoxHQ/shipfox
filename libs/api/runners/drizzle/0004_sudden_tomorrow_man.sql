CREATE TYPE "public"."runners_resource_state" AS ENUM('starting', 'running', 'stopping', 'stopped', 'failed');--> statement-breakpoint
CREATE TABLE "runners_resources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provisioner_id" uuid NOT NULL,
	"resource_id" text NOT NULL,
	"reservation_id" uuid,
	"template_key" text,
	"labels" text[] NOT NULL,
	"state" "runners_resource_state" NOT NULL,
	"reason" text,
	"runner_session_id" uuid,
	"provider_kind" text,
	"reported_at" timestamp with time zone NOT NULL,
	"reservation_released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "runners_resources_workspace_provisioner_resource_unique" ON "runners_resources" USING btree ("workspace_id","provisioner_id","resource_id");--> statement-breakpoint
CREATE INDEX "runners_resources_workspace_state_updated_idx" ON "runners_resources" USING btree ("workspace_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "runners_resources_reservation_id_idx" ON "runners_resources" USING btree ("reservation_id");
