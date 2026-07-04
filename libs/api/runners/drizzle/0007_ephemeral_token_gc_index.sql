CREATE INDEX "runners_ephemeral_registration_tokens_terminal_idx" ON "runners_ephemeral_registration_tokens" USING btree (coalesce("consumed_at", "expires_at"),"id");
