CREATE TABLE "integrations_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle_status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
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
CREATE TABLE "integrations_webhook_deliveries" (
	"provider" text NOT NULL,
	"dedup_scope" text NOT NULL,
	"delivery_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_webhook_deliveries_dedup_pk" PRIMARY KEY("provider","dedup_scope","delivery_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_connections_workspace_external_unique" ON "integrations_connections" USING btree ("workspace_id","provider","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_connections_workspace_slug_unique" ON "integrations_connections" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "integrations_connections_workspace_id_idx" ON "integrations_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "integrations_outbox_pending_idx" ON "integrations_outbox" USING btree ("next_dispatch_at","created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "integrations_outbox_dispatched_retention_idx" ON "integrations_outbox" USING btree ("dispatched_at","id") WHERE "dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "integrations_webhook_deliveries_received_at_idx" ON "integrations_webhook_deliveries" USING btree ("received_at");
