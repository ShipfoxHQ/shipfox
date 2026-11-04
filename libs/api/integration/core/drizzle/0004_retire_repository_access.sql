UPDATE "integrations_connections" SET "repository_access" = 'all' WHERE "repository_access" <> 'all';--> statement-breakpoint
UPDATE "integrations_secret_cleanups" SET "repository_access" = 'all' WHERE "repository_access" <> 'all';--> statement-breakpoint
ALTER TABLE "integrations_connections" DROP COLUMN "repository_access";--> statement-breakpoint
ALTER TABLE "integrations_secret_cleanups" DROP COLUMN "repository_access";
