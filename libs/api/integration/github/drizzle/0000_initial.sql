CREATE TABLE "integrations_github_installations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"latest_event" jsonb NOT NULL,
	"installer_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_github_installations_connection_unique" ON "integrations_github_installations" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_github_installations_installation_unique" ON "integrations_github_installations" USING btree ("installation_id");
