CREATE TABLE "provisioners_provisioner_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hashed_token" text NOT NULL,
	"prefix" text NOT NULL,
	"name" text,
	"created_by_user_id" uuid NOT NULL,
	"revoked_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provisioners_provisioner_tokens_hashed_token_unique" ON "provisioners_provisioner_tokens" USING btree ("hashed_token");--> statement-breakpoint
CREATE INDEX "provisioners_provisioner_tokens_workspace_id_idx" ON "provisioners_provisioner_tokens" USING btree ("workspace_id");
