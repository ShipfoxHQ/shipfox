CREATE TABLE "email_challenges_challenges" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "email" text,
  "purpose" text NOT NULL,
  "continuation_hmac" text,
  "code_hmac" text,
  "expires_at" timestamp with time zone NOT NULL,
  "sent_count" integer DEFAULT 1 NOT NULL,
  "resend_count" integer DEFAULT 0 NOT NULL,
  "failed_attempt_count" integer DEFAULT 0 NOT NULL,
  "last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at" timestamp with time zone,
  "proof_expires_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "consumed_continuation_hmac" text,
  "invalidated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "terminal_at" timestamp with time zone
);
CREATE INDEX "email_challenges_expiry_idx" ON "email_challenges_challenges" USING btree ("expires_at");
CREATE INDEX "email_challenges_terminal_idx" ON "email_challenges_challenges" USING btree ("terminal_at");
CREATE TABLE "email_challenges_send_limits" (
  "scope" text NOT NULL,
  "identifier_hmac" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
CREATE INDEX "email_challenges_send_limits_lookup_idx" ON "email_challenges_send_limits" USING btree ("scope", "identifier_hmac", "expires_at");
CREATE INDEX "email_challenges_send_limits_expiry_idx" ON "email_challenges_send_limits" USING btree ("expires_at");
