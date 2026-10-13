CREATE TABLE "usage_storage_samples" (
	"id" uuid NOT NULL DEFAULT uuidv7(),
	"sample_key" text NOT NULL,
	"source" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"stored_bytes" bigint NOT NULL,
	"object_count" bigint NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
) PARTITION BY RANGE ("recorded_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "usage_ensure_monthly_partitions"(reference_time timestamptz)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  table_name text;
  default_table_name text;
  key_columns text;
  minimum_recorded_at timestamptz;
  maximum_recorded_at timestamptz;
  current_month date := date_trunc('month', reference_time AT TIME ZONE 'UTC')::date;
  month_start date;
  partition_end date;
  range_end date;
  suffix text;
  child_name text;
  stage_name text;
  lower_bound text;
  upper_bound text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('shipfox.usage.monthly-partitions'));
  LOCK TABLE "usage_job_executions", "usage_inference_segments", "usage_storage_samples"
    IN SHARE ROW EXCLUSIVE MODE;

  FOR table_name, default_table_name, key_columns IN
    VALUES
      ('usage_job_executions', 'usage_job_executions_unrecorded', '"job_execution_id", "recorded_at"'),
      ('usage_inference_segments', 'usage_inference_segments_default', '"id", "recorded_at"'),
      ('usage_storage_samples', 'usage_storage_samples_default', '"id", "recorded_at"')
  LOOP
    EXECUTE format('SELECT min(recorded_at), max(recorded_at) FROM %I', default_table_name)
      INTO minimum_recorded_at, maximum_recorded_at;

    month_start := least(
      current_month,
      coalesce(date_trunc('month', minimum_recorded_at AT TIME ZONE 'UTC')::date, current_month)
    );
    range_end := greatest(
      current_month,
      coalesce(date_trunc('month', maximum_recorded_at AT TIME ZONE 'UTC')::date, current_month)
    );

    WHILE month_start <= range_end LOOP
      partition_end := (month_start + interval '1 month')::date;
      suffix := to_char(month_start, 'YYYY_MM');
      child_name := table_name || '_' || suffix;
      stage_name := 'usage_partition_stage_' || replace(table_name, 'usage_', '') || '_' || suffix;
      lower_bound := to_char(month_start, 'YYYY-MM-DD') || ' 00:00:00+00';
      upper_bound := to_char(partition_end, 'YYYY-MM-DD') || ' 00:00:00+00';

      EXECUTE format(
        'CREATE TEMP TABLE %I ON COMMIT DROP AS SELECT * FROM %I WHERE false',
        stage_name,
        default_table_name
      );
      EXECUTE format(
        'INSERT INTO %I SELECT * FROM %I WHERE recorded_at >= %L::timestamptz AND recorded_at < %L::timestamptz',
        stage_name,
        default_table_name,
        lower_bound,
        upper_bound
      );
      EXECUTE format(
        'DELETE FROM %I WHERE recorded_at >= %L::timestamptz AND recorded_at < %L::timestamptz',
        default_table_name,
        lower_bound,
        upper_bound
      );

      IF to_regclass(child_name) IS NULL THEN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
          child_name,
          table_name,
          lower_bound,
          upper_bound
        );
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (%s)',
          child_name,
          child_name || '_pkey',
          key_columns
        );
      END IF;

      EXECUTE format('INSERT INTO %I SELECT * FROM %I ON CONFLICT DO NOTHING', child_name, stage_name);
      EXECUTE format('DROP TABLE %I', stage_name);
      month_start := partition_end;
    END LOOP;
  END LOOP;
END;
$function$;
--> statement-breakpoint
CREATE TABLE "usage_storage_samples_default" PARTITION OF "usage_storage_samples" DEFAULT;
ALTER TABLE "usage_storage_samples_default" ADD CONSTRAINT "usage_storage_samples_default_pkey" PRIMARY KEY ("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_storage_samples_sample_key_recorded_unique" ON "usage_storage_samples" USING btree ("sample_key", "recorded_at");
CREATE INDEX "usage_storage_samples_workspace_recorded_idx" ON "usage_storage_samples" USING btree ("workspace_id", "recorded_at");
CREATE INDEX "usage_storage_samples_recorded_id_idx" ON "usage_storage_samples" USING btree ("recorded_at", "id");
