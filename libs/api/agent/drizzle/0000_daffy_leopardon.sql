CREATE TABLE "agent_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"encrypted_credentials" jsonb NOT NULL,
	"key_fingerprints" jsonb NOT NULL,
	"default_model" text NOT NULL,
	"default_thinking" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_workspace_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"default_provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_provider_configs_workspace_provider_unique" ON "agent_provider_configs" USING btree ("workspace_id","provider_id");--> statement-breakpoint
CREATE INDEX "agent_provider_configs_workspace_idx" ON "agent_provider_configs" USING btree ("workspace_id");