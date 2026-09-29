CREATE TABLE "integrations_discord_installations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"permissions" text NOT NULL,
	"installed_by_discord_user_id" text,
	"bot_role_id" text,
	"status" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_discord_installations_connection_unique" ON "integrations_discord_installations" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_discord_installations_guild_unique" ON "integrations_discord_installations" USING btree ("guild_id");