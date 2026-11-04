CREATE TABLE "agent_conversation_run_links" (
	"conversation_id" uuid NOT NULL,
	"workflow_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"check_requested_at" timestamp with time zone,
	CONSTRAINT "agent_conversation_run_links_pkey" PRIMARY KEY("conversation_id","workflow_run_id")
);
--> statement-breakpoint
ALTER TABLE "agent_conversation_items" ADD COLUMN "run_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_conversation_run_links" ADD CONSTRAINT "agent_conversation_run_links_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_conversation_run_links_run_idx" ON "agent_conversation_run_links" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "agent_conversation_run_links_check_idx" ON "agent_conversation_run_links" USING btree ("check_requested_at") WHERE "agent_conversation_run_links"."check_requested_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_items_run_attempt_unique" ON "agent_conversation_items" USING btree ("conversation_id","run_attempt_id") WHERE "agent_conversation_items"."run_attempt_id" is not null;