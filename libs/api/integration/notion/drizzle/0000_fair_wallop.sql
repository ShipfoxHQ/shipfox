CREATE TABLE "integrations_notion_installations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"notion_workspace_id" uuid NOT NULL,
	"workspace_name" text NOT NULL,
	"bot_id" uuid NOT NULL,
	"authorized_by_user_id" uuid NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_notion_installations_connection_unique" ON "integrations_notion_installations" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_notion_installations_workspace_unique" ON "integrations_notion_installations" USING btree ("notion_workspace_id");