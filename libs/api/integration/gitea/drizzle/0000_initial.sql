CREATE TABLE "integrations_gitea_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"org" text NOT NULL,
	"webhook_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_gitea_connections_connection_unique" ON "integrations_gitea_connections" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_gitea_connections_org_unique" ON "integrations_gitea_connections" USING btree ("org");