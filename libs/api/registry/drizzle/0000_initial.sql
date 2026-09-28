CREATE TABLE "registry_versions" (
	"registry" text NOT NULL,
	"package" text NOT NULL,
	"version" text NOT NULL,
	"kind" text NOT NULL,
	"digest" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"document" jsonb NOT NULL,
	"content" "bytea" NOT NULL,
	"source" "bytea",
	"readme" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_versions_pkey" PRIMARY KEY("registry","package","version")
);
