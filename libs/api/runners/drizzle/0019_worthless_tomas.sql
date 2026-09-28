CREATE TABLE "runners_expired_job_executions" (
	"job_execution_id" uuid PRIMARY KEY NOT NULL,
	"expired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "runners_expired_job_executions_expired_at_idx" ON "runners_expired_job_executions" USING btree ("expired_at");
