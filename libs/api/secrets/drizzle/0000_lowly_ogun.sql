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
	CONSTRAINT "secrets_variables_key_ck" CHECK ("secrets_variables"."key" ~ '^[A-Z_][A-Z0-9_]*$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_values_ws_scope_unique" ON "secrets_values" USING btree ("workspace_id","namespace","key") WHERE "project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_values_project_scope_unique" ON "secrets_values" USING btree ("workspace_id","project_id","namespace","key") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "secrets_values_lookup_idx" ON "secrets_values" USING btree ("workspace_id","namespace","project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_variables_ws_scope_unique" ON "secrets_variables" USING btree ("workspace_id","namespace","key") WHERE "project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_variables_project_scope_unique" ON "secrets_variables" USING btree ("workspace_id","project_id","namespace","key") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "secrets_variables_lookup_idx" ON "secrets_variables" USING btree ("workspace_id","namespace","project_id","key");
