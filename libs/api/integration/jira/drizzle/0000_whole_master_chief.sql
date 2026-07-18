CREATE TABLE "integrations_jira_installations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"cloud_id" text NOT NULL,
	"site_url" text NOT NULL,
	"site_name" text NOT NULL,
	"authorizing_account_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"webhook_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_expires_at" timestamp with time zone,
	"status" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_jira_installations_connection_unique" ON "integrations_jira_installations" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "integrations_jira_installations_cloud_id_idx" ON "integrations_jira_installations" USING btree ("cloud_id");