CREATE TABLE "integrations_discord_gateway_sessions" (
	"shard_id" integer PRIMARY KEY NOT NULL,
	"session_id" text,
	"resume_gateway_url" text,
	"received_sequence" bigint,
	"committed_sequence" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
