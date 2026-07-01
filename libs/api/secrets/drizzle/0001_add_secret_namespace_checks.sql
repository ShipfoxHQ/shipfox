ALTER TABLE "secrets_values" DROP CONSTRAINT "secrets_values_key_ck";--> statement-breakpoint
ALTER TABLE "secrets_variables" DROP CONSTRAINT "secrets_variables_key_ck";--> statement-breakpoint
ALTER TABLE "secrets_values" ADD CONSTRAINT "secrets_values_namespace_ck" CHECK ("secrets_values"."namespace" = '' OR "secrets_values"."namespace" ~ '^[a-z0-9]([a-z0-9_/-]*[a-z0-9])?$');--> statement-breakpoint
ALTER TABLE "secrets_values" ADD CONSTRAINT "secrets_values_key_ck" CHECK ("secrets_values"."key" ~ '^[A-Z_][A-Z0-9_]*$');--> statement-breakpoint
ALTER TABLE "secrets_variables" ADD CONSTRAINT "secrets_variables_namespace_ck" CHECK ("secrets_variables"."namespace" = '' OR "secrets_variables"."namespace" ~ '^[a-z0-9]([a-z0-9_/-]*[a-z0-9])?$');--> statement-breakpoint
ALTER TABLE "secrets_variables" ADD CONSTRAINT "secrets_variables_key_ck" CHECK ("secrets_variables"."key" ~ '^[A-Z_][A-Z0-9_]*$');