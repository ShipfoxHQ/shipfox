CREATE TABLE "integrations_claap_installations" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_name" text NOT NULL,
	"key_hint" varchar(4) NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
