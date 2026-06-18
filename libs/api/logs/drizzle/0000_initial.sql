CREATE TABLE "logs_attempt_streams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"committed_length" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"close_reason" text,
	"declared_total_bytes" bigint,
	"truncated" boolean DEFAULT false NOT NULL,
	"object_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs_chunks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"stream_id" uuid NOT NULL,
	"seq" bigserial NOT NULL,
	"stream_offset" bigint NOT NULL,
	"byte_len" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs_job_accounting" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"stored_bytes_used" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"capped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "logs_chunks" ADD CONSTRAINT "logs_chunks_stream_id_logs_attempt_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."logs_attempt_streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "logs_attempt_streams_identity_unique" ON "logs_attempt_streams" USING btree ("job_id","step_id","attempt");--> statement-breakpoint
CREATE INDEX "logs_chunks_stream_seq_idx" ON "logs_chunks" USING btree ("stream_id","seq");--> statement-breakpoint
CREATE INDEX "logs_outbox_pending_idx" ON "logs_outbox" USING btree ("created_at") WHERE "dispatched_at" IS NULL;