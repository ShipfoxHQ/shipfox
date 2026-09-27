CREATE TABLE "definitions_action_snapshots" (
	"workspace_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"project_id" uuid NOT NULL,
	"manifest" jsonb NOT NULL,
	"bundle" "bytea" NOT NULL,
	"file_count" integer NOT NULL,
	"bytes" integer NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "definitions_action_snapshots_pkey" PRIMARY KEY("workspace_id","digest")
);
