CREATE TABLE "workflows_step_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"step_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" "workflows_step_status" NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"exit_code" integer,
	"gate_result" jsonb,
	"restart_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_step_attempts_step_id_attempt_uq" UNIQUE("step_id","attempt")
);
--> statement-breakpoint
ALTER TABLE "workflows_steps" ADD COLUMN "current_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD CONSTRAINT "workflows_step_attempts_step_id_workflows_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."workflows_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows_step_attempts" ADD CONSTRAINT "workflows_step_attempts_job_id_workflows_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."workflows_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflows_step_attempts_job_id_idx" ON "workflows_step_attempts" USING btree ("job_id");