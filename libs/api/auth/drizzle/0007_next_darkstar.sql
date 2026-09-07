CREATE TABLE "auth_impersonation_windows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"actor_role_at_start" "auth_admin_role" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	CONSTRAINT "auth_impersonation_windows_terminal_consistency_ck" CHECK (("auth_impersonation_windows"."ended_at" IS NULL AND "auth_impersonation_windows"."ended_reason" IS NULL) OR ("auth_impersonation_windows"."ended_at" IS NOT NULL AND "auth_impersonation_windows"."ended_reason" IS NOT NULL)),
	CONSTRAINT "auth_impersonation_windows_deadline_after_start_ck" CHECK ("auth_impersonation_windows"."deadline_at" > "auth_impersonation_windows"."started_at"),
	CONSTRAINT "auth_impersonation_windows_ended_reason_ck" CHECK ("auth_impersonation_windows"."ended_reason" IS NULL OR "auth_impersonation_windows"."ended_reason" IN ('stopped', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "auth_impersonation_windows" ADD CONSTRAINT "auth_impersonation_windows_actor_id_auth_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_impersonation_windows" ADD CONSTRAINT "auth_impersonation_windows_target_user_id_auth_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_impersonation_windows_actor_open_started_id_idx" ON "auth_impersonation_windows" USING btree ("actor_id","started_at" desc,"id" desc) WHERE "auth_impersonation_windows"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "auth_impersonation_windows_target_started_idx" ON "auth_impersonation_windows" USING btree ("target_user_id","started_at" desc);