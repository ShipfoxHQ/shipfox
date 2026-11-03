CREATE TABLE "definitions_agents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"config_path" text NOT NULL,
	"config" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_agents_project_key_unique" ON "definitions_agents" USING btree ("project_id","key");