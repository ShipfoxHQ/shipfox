CREATE TABLE "integrations_linear_installations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"organization_url_key" text NOT NULL,
	"app_user_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_linear_installations_connection_unique" ON "integrations_linear_installations" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_linear_installations_organization_unique" ON "integrations_linear_installations" USING btree ("organization_id");