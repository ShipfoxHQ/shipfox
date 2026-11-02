ALTER TABLE "usage_inference_segments" ALTER COLUMN "workflow_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ALTER COLUMN "workflow_run_attempt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ALTER COLUMN "job_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ALTER COLUMN "job_execution_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ALTER COLUMN "step_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ALTER COLUMN "step_attempt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ADD COLUMN "agent_key" text;--> statement-breakpoint
ALTER TABLE "usage_inference_segments" ADD CONSTRAINT "usage_inference_segments_subject_ck" CHECK ((
        conversation_id IS NULL
        AND agent_key IS NULL
        AND workflow_run_id IS NOT NULL
        AND workflow_run_attempt_id IS NOT NULL
        AND job_id IS NOT NULL
        AND job_execution_id IS NOT NULL
        AND step_id IS NOT NULL
        AND step_attempt_id IS NOT NULL
      ) OR (
        conversation_id IS NOT NULL
        AND agent_key IS NOT NULL
        AND workflow_run_id IS NULL
        AND workflow_run_attempt_id IS NULL
        AND job_id IS NULL
        AND job_execution_id IS NULL
        AND step_id IS NULL
        AND step_attempt_id IS NULL
      ));