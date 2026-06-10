CREATE TABLE "triggers_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
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
CREATE INDEX "triggers_outbox_pending_idx" ON "triggers_outbox" USING btree ("created_at") WHERE "dispatched_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_subscriptions_definition_name_unique" ON "triggers_subscriptions" USING btree ("workflow_definition_id","name");--> statement-breakpoint
CREATE INDEX "triggers_subscriptions_match_idx" ON "triggers_subscriptions" USING btree ("workspace_id","source","event");--> statement-breakpoint
CREATE INDEX "triggers_subscriptions_definition_idx" ON "triggers_subscriptions" USING btree ("workflow_definition_id");