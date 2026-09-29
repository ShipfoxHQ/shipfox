CREATE TABLE "integrations_github_unlinked_installations" (
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"sender_login" text,
	"requester_login" text,
	"last_action" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_github_unlinked_installations_installation_unique" ON "integrations_github_unlinked_installations" USING btree ("installation_id");