CREATE INDEX IF NOT EXISTS "definitions_wd_project_name_id_idx" ON "definitions_workflow_definitions" USING btree ("project_id","name","id") WHERE "deleted_at" IS NULL;
