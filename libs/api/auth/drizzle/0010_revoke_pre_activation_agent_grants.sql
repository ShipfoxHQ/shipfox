UPDATE "auth_agent_grants"
SET
  "revoked_at" = COALESCE("revoked_at", now()),
  "terminal_at" = now(),
  "updated_at" = now()
WHERE "terminal_at" IS NULL;