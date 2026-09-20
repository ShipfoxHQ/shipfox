CREATE TABLE "integrations_posthog_installations" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"project_name" text NOT NULL,
	"organization_id" text NOT NULL,
	"key_hint" text NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
