CREATE TABLE "integrations_slack_installations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"app_id" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"status" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_slack_installations_connection_unique" ON "integrations_slack_installations" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_slack_installations_team_unique" ON "integrations_slack_installations" USING btree ("team_id");