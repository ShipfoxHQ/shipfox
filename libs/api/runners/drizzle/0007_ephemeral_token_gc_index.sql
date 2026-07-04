CREATE INDEX "runners_ephemeral_registration_tokens_created_id_idx" ON "runners_ephemeral_registration_tokens" USING btree ("created_at","id");
