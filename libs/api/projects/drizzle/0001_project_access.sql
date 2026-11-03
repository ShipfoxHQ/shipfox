CREATE TABLE "projects_connection_resources" (
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"resource_kind" text NOT NULL,
	"external_resource_id" text NOT NULL,
	"lookup_name" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_connection_resources_pk" PRIMARY KEY("project_id","connection_id","resource_kind","external_resource_id")
);
--> statement-breakpoint
CREATE TABLE "projects_connection_scopes" (
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"resource_scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_connection_scopes_pk" PRIMARY KEY("project_id","connection_id")
);
--> statement-breakpoint
ALTER TABLE "projects_projects" ADD COLUMN "connection_access" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects_connection_resources" ADD CONSTRAINT "projects_connection_resources_scope_fk" FOREIGN KEY ("project_id","connection_id") REFERENCES "public"."projects_connection_scopes"("project_id","connection_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects_connection_scopes" ADD CONSTRAINT "projects_connection_scopes_project_id_projects_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_connection_resources_external_idx" ON "projects_connection_resources" USING btree ("connection_id","resource_kind","external_resource_id");--> statement-breakpoint
CREATE INDEX "projects_connection_scopes_connection_idx" ON "projects_connection_scopes" USING btree ("connection_id");