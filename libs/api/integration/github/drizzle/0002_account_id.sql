ALTER TABLE "integrations_github_installations" ADD COLUMN "account_id" text;--> statement-breakpoint
CREATE INDEX "integrations_github_installations_account_idx" ON "integrations_github_installations" USING btree ("account_type","account_id");--> statement-breakpoint
UPDATE "integrations_github_installations" SET "account_id" = "latest_event"->'account'->>'id' WHERE "account_id" IS NULL;
