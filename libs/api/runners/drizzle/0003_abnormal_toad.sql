CREATE TABLE "runners_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provisioner_id" uuid NOT NULL,
	"required_labels" text[] NOT NULL,
	"count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runners_reservations_count_positive_ck" CHECK ("runners_reservations"."count" > 0)
);
--> statement-breakpoint
CREATE INDEX "runners_reservations_workspace_expires_idx" ON "runners_reservations" USING btree ("workspace_id","expires_at");
--> statement-breakpoint
CREATE INDEX "runners_reservations_expires_idx" ON "runners_reservations" USING btree ("expires_at");
