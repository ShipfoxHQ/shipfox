CREATE TABLE "integrations_managed_objects" (
	"repository_id" uuid NOT NULL,
	"oid" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "integrations_managed_objects_repository_id_oid_pk" PRIMARY KEY("repository_id","oid")
);
--> statement-breakpoint
CREATE TABLE "integrations_managed_refs" (
	"repository_id" uuid NOT NULL,
	"name" text NOT NULL,
	"commit_oid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_managed_refs_repository_id_name_pk" PRIMARY KEY("repository_id","name")
);
--> statement-breakpoint
CREATE TABLE "integrations_managed_repositories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations_managed_objects" ADD CONSTRAINT "integrations_managed_objects_repository_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."integrations_managed_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations_managed_refs" ADD CONSTRAINT "integrations_managed_refs_repository_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."integrations_managed_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations_managed_refs" ADD CONSTRAINT "integrations_managed_refs_commit_fk" FOREIGN KEY ("repository_id","commit_oid") REFERENCES "public"."integrations_managed_objects"("repository_id","oid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_managed_repositories_project_unique" ON "integrations_managed_repositories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "integrations_managed_repositories_workspace_idx" ON "integrations_managed_repositories" USING btree ("workspace_id","id");