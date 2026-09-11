ALTER TABLE "auth_agent_authorization_requests" ALTER COLUMN "scopes" SET DEFAULT '{"read"}';--> statement-breakpoint
ALTER TABLE "auth_agent_authorization_requests" ALTER COLUMN "scopes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_agent_grants" ALTER COLUMN "scopes" SET DEFAULT '{"read"}';--> statement-breakpoint
ALTER TABLE "auth_agent_grants" ALTER COLUMN "scopes" DROP NOT NULL;
