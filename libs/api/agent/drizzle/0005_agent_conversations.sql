CREATE TABLE "agent_conversation_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer,
	"kind" text NOT NULL,
	"turn_id" uuid,
	"author_user_id" uuid,
	"client_message_id" uuid,
	"body" "bytea" NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_key" text NOT NULL,
	"origin_kind" text NOT NULL,
	"owner_user_id" uuid,
	"client_message_id" uuid,
	"title" "bytea",
	"last_seq" integer DEFAULT 0 NOT NULL,
	"last_agent_seq" integer DEFAULT 0 NOT NULL,
	"last_read_seq" integer DEFAULT 0 NOT NULL,
	"run_starts_since_human" integer DEFAULT 0 NOT NULL,
	"compaction_through_seq" integer DEFAULT 0 NOT NULL,
	"retry_requested_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_conversations_web_owner_ck" CHECK (("agent_conversations"."origin_kind" = 'web') = ("agent_conversations"."owner_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "agent_turn_stream_chunks" (
	"turn_id" uuid NOT NULL,
	"model_call_index" integer NOT NULL,
	"chunk_seq" integer NOT NULL,
	"body" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_turn_stream_chunks_pkey" PRIMARY KEY("turn_id","model_call_index","chunk_seq")
);
--> statement-breakpoint
CREATE TABLE "agent_turns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"failure_code" text,
	"stop_requested_at" timestamp with time zone,
	"model" text,
	"provider" text,
	"model_call_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_conversation_items" ADD CONSTRAINT "agent_conversation_items_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_items" ADD CONSTRAINT "agent_conversation_items_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_turn_stream_chunks" ADD CONSTRAINT "agent_turn_stream_chunks_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_items_seq_unique" ON "agent_conversation_items" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_items_client_message_unique" ON "agent_conversation_items" USING btree ("conversation_id","client_message_id") WHERE "agent_conversation_items"."client_message_id" is not null;--> statement-breakpoint
CREATE INDEX "agent_conversation_items_queued_idx" ON "agent_conversation_items" USING btree ("conversation_id","id") WHERE "agent_conversation_items"."seq" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversations_client_message_unique" ON "agent_conversations" USING btree ("project_id","owner_user_id","client_message_id") WHERE "agent_conversations"."client_message_id" is not null;--> statement-breakpoint
CREATE INDEX "agent_conversations_web_owner_activity_idx" ON "agent_conversations" USING btree ("project_id","owner_user_id","last_activity_at","id") WHERE "agent_conversations"."origin_kind" = 'web';--> statement-breakpoint
CREATE INDEX "agent_conversations_retry_requested_idx" ON "agent_conversations" USING btree ("retry_requested_at") WHERE "agent_conversations"."retry_requested_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_turns_one_running_unique" ON "agent_turns" USING btree ("conversation_id") WHERE "agent_turns"."status" = 'running';