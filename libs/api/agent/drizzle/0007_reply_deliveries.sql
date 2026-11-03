CREATE TABLE "agent_reply_deliveries" (
	"reply_id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_reply_deliveries" ADD CONSTRAINT "agent_reply_deliveries_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_reply_deliveries_conversation_idx" ON "agent_reply_deliveries" USING btree ("conversation_id");