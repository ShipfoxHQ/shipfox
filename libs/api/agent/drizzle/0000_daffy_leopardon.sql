CREATE TYPE "public"."model_provider_config_kind" AS ENUM('builtin', 'custom');--> statement-breakpoint
CREATE TABLE "model_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"kind" "model_provider_config_kind" DEFAULT 'builtin' NOT NULL,
	"display_name" text,
	"api" text,
	"base_url" text,
	"headers" jsonb,
	"secret_header_names" jsonb,
	"models" jsonb,
	"requires_api_key" boolean DEFAULT false NOT NULL,
	"default_model" text,
	"default_thinking" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_provider_configs_custom_required_fields" CHECK ("kind" <> 'custom' OR ("api" IS NOT NULL AND "base_url" IS NOT NULL AND "models" IS NOT NULL AND "display_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "agent_workspace_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"default_provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_configs_workspace_provider_unique" ON "model_provider_configs" USING btree ("workspace_id","provider_id");
