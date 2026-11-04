CREATE TABLE "triggers_agent_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_key" text NOT NULL,
	"source" text NOT NULL,
	"filter" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_agent_subscriptions_rule_unique" ON "triggers_agent_subscriptions" USING btree ("project_id","agent_key","source",coalesce("filter", ''));--> statement-breakpoint
CREATE INDEX "triggers_agent_subscriptions_match_idx" ON "triggers_agent_subscriptions" USING btree ("workspace_id","source");