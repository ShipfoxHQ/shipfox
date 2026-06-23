CREATE TABLE "triggers_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"received_event_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"workflow_definition_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"run_id" uuid,
	"run_name" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers_outbox" (
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
CREATE TABLE "triggers_received_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_ref" text NOT NULL,
	"origin" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"event" text NOT NULL,
	"delivery_id" text,
	"connection_id" uuid,
	"outcome" text DEFAULT 'received' NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_definition_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"event" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "triggers_decisions" ADD CONSTRAINT "triggers_decisions_received_event_id_triggers_received_events_id_fk" FOREIGN KEY ("received_event_id") REFERENCES "public"."triggers_received_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_decisions_event_subscription_unique" ON "triggers_decisions" USING btree ("received_event_id","subscription_id");--> statement-breakpoint
CREATE INDEX "triggers_decisions_run_idx" ON "triggers_decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "triggers_outbox_pending_idx" ON "triggers_outbox" USING btree ("next_dispatch_at","created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "triggers_outbox_dispatched_retention_idx" ON "triggers_outbox" USING btree ("dispatched_at","id") WHERE "dispatched_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_received_events_event_ref_unique" ON "triggers_received_events" USING btree ("event_ref");--> statement-breakpoint
CREATE INDEX "triggers_received_events_workspace_received_idx" ON "triggers_received_events" USING btree ("workspace_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "triggers_received_events_prune_idx" ON "triggers_received_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_subscriptions_definition_name_unique" ON "triggers_subscriptions" USING btree ("workflow_definition_id","name");--> statement-breakpoint
CREATE INDEX "triggers_subscriptions_match_idx" ON "triggers_subscriptions" USING btree ("workspace_id","source","event");--> statement-breakpoint
CREATE INDEX "triggers_subscriptions_definition_idx" ON "triggers_subscriptions" USING btree ("workflow_definition_id");
