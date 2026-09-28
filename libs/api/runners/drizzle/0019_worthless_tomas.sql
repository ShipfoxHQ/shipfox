CREATE TABLE "runners_expired_job_executions" (
	"job_execution_id" uuid PRIMARY KEY NOT NULL,
	"expired_at" timestamp with time zone DEFAULT now() NOT NULL
);
