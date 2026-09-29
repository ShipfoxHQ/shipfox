CREATE TABLE "registry_audit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"namespace" text,
	"package" text,
	"version" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_packages" (
	"name" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"kind" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"first_published_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"integrations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latest_version" text NOT NULL,
	"latest_published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "registry_packages_kind_check" CHECK ("registry_packages"."kind" in ('action', 'template'))
);
--> statement-breakpoint
CREATE TABLE "registry_used_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_versions" (
	"package" text NOT NULL,
	"version" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"document" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"content_digest" text NOT NULL,
	"source_digest" text NOT NULL,
	"readme" text,
	"bump" text,
	"capability_change" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "registry_versions_pkey" PRIMARY KEY("package","version"),
	CONSTRAINT "registry_versions_bump_check" CHECK ("registry_versions"."bump" is null or "registry_versions"."bump" in ('major', 'minor', 'patch'))
);
--> statement-breakpoint
ALTER TABLE "registry_versions" ADD CONSTRAINT "registry_versions_package_registry_packages_name_fk" FOREIGN KEY ("package") REFERENCES "public"."registry_packages"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registry_audit_at_idx" ON "registry_audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "registry_audit_namespace_idx" ON "registry_audit" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "registry_packages_namespace_idx" ON "registry_packages" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "registry_packages_kind_idx" ON "registry_packages" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "registry_used_tokens_expires_at_idx" ON "registry_used_tokens" USING btree ("expires_at");