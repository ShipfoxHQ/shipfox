ALTER TYPE "public"."definitions_sync_error_code" ADD VALUE 'action-not-found' BEFORE 'unknown';--> statement-breakpoint
ALTER TYPE "public"."definitions_sync_error_code" ADD VALUE 'action-invalid' BEFORE 'unknown';--> statement-breakpoint
ALTER TYPE "public"."definitions_sync_error_code" ADD VALUE 'action-too-large' BEFORE 'unknown';--> statement-breakpoint
ALTER TYPE "public"."definitions_sync_error_code" ADD VALUE 'action-unsupported-file' BEFORE 'unknown';