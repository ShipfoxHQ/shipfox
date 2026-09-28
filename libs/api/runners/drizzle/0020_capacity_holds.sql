CREATE TABLE "runners_capacity_holds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"reservation_id" uuid,
	"runner_instance_id" uuid,
	"job_execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "runners_capacity_holds_units_positive_ck" CHECK ("runners_capacity_holds"."units" > 0)
);
--> statement-breakpoint
CREATE INDEX "runners_capacity_holds_workspace_active_idx" ON "runners_capacity_holds" USING btree ("workspace_id") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "runners_capacity_holds_reservation_unbound_idx" ON "runners_capacity_holds" USING btree ("reservation_id") WHERE runner_instance_id is null and released_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "runners_capacity_holds_runner_active_unique" ON "runners_capacity_holds" USING btree ("runner_instance_id") WHERE runner_instance_id is not null and released_at is null;