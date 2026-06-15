CREATE TABLE "integrations_sentry_installations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid,
	"installation_uuid" text NOT NULL,
	"org_slug" text NOT NULL,
	"status" text NOT NULL,
	"code_hash" text,
	"installer_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_sentry_installations_connection_unique" ON "integrations_sentry_installations" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_sentry_installations_installation_unique" ON "integrations_sentry_installations" USING btree ("installation_uuid");
