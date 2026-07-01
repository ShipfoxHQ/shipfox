CREATE TABLE "secrets_data_keys" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kek_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "secrets_values" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_edited_by" uuid,
	CONSTRAINT "secrets_values_namespace_ck" CHECK (char_length("secrets_values"."namespace") <= 128 AND ("secrets_values"."namespace" = '' OR "secrets_values"."namespace" ~ '^[a-z0-9]([a-z0-9_/-]*[a-z0-9])?$')),
	CONSTRAINT "secrets_values_key_ck" CHECK ("secrets_values"."key" ~ '^[A-Z_][A-Z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "secrets_variables" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_edited_by" uuid,
	CONSTRAINT "secrets_variables_namespace_ck" CHECK (char_length("secrets_variables"."namespace") <= 128 AND ("secrets_variables"."namespace" = '' OR "secrets_variables"."namespace" ~ '^[a-z0-9]([a-z0-9_/-]*[a-z0-9])?$')),
	CONSTRAINT "secrets_variables_key_ck" CHECK ("secrets_variables"."key" ~ '^[A-Z_][A-Z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "secrets_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"next_dispatch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_dispatch_error" jsonb,
	"last_dispatch_failed_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_values_ws_scope_unique" ON "secrets_values" USING btree ("workspace_id","namespace","key") WHERE "project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_values_project_scope_unique" ON "secrets_values" USING btree ("workspace_id","project_id","namespace","key") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "secrets_values_lookup_idx" ON "secrets_values" USING btree ("workspace_id","namespace","project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_variables_ws_scope_unique" ON "secrets_variables" USING btree ("workspace_id","namespace","key") WHERE "project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_variables_project_scope_unique" ON "secrets_variables" USING btree ("workspace_id","project_id","namespace","key") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "secrets_variables_lookup_idx" ON "secrets_variables" USING btree ("workspace_id","namespace","project_id","key");--> statement-breakpoint
CREATE INDEX "secrets_outbox_pending_idx" ON "secrets_outbox" USING btree ("next_dispatch_at","created_at") WHERE "dispatched_at" IS NULL AND "dead_lettered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "secrets_outbox_dispatched_retention_idx" ON "secrets_outbox" USING btree ("dispatched_at","id") WHERE "dispatched_at" IS NOT NULL;
