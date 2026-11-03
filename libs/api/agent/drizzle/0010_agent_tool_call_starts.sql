CREATE TABLE "agent_tool_call_starts" (
	"turn_id" uuid NOT NULL,
	"model_call_index" integer NOT NULL,
	"call_index" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tool_call_starts_pkey" PRIMARY KEY("turn_id","model_call_index","call_index")
);
--> statement-breakpoint
ALTER TABLE "agent_tool_call_starts" ADD CONSTRAINT "agent_tool_call_starts_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE cascade ON UPDATE no action;