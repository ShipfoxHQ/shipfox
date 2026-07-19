CREATE TABLE "integrations_jira_pending_selections" (
  "state_hash" text PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "sites" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "integrations_jira_installations_cloud_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_jira_installations_cloud_id_unique" ON "integrations_jira_installations" USING btree ("cloud_id");
