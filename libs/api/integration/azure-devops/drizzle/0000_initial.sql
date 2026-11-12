CREATE TABLE "integrations_azure_devops_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"organization" text NOT NULL,
	"webhook_username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_azure_devops_connections_connection_unique" ON "integrations_azure_devops_connections" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_azure_devops_connections_organization_unique" ON "integrations_azure_devops_connections" USING btree ("organization");