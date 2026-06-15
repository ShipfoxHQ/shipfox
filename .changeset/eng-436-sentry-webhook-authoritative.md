---
"@shipfox/api-integration-sentry-dto": minor
"@shipfox/api-integration-sentry": minor
"@shipfox/api-integration-core": minor
"@shipfox/client-integrations": patch
---

[api/integrations] Make the signed Sentry installation webhook authoritative.

- `@shipfox/api-integration-sentry-dto`: reshape `sentryInstallationWebhookSchema`
  to read `data.installation.{uuid, organization.slug, status, code}` plus an
  optional top-level `actor`. Only consumed fields are validated and the raw
  `code` is never logged.
- `@shipfox/api-integration-sentry`: the signed `installation.created` webhook now
  exchanges the single-use code and persists a verified-but-unclaimed installation
  (`connection_id IS NULL`, `code_hash = sha256(code)`). The browser flow narrows
  to a claim that binds a verified install to a workspace under unified claim auth
  (exchange-success, same-code hash match, or a retryable
  `verification-in-progress` while a concurrent webhook is mid-exchange), with a
  proof-mismatch 403 closing the bare-uuid IDOR. The exchange/verify run outside
  the DB transaction; a short transaction wraps persist + delivery record. Adds
  `connection_id` nullable + `code_hash` to the installations table and a daily TTL
  cron that tombstones never-claimed installs.
- `@shipfox/api-integration-core`: inject the Sentry client into the webhook
  context, resolve a null `connection_id` to "no connection" for pre-claim issue
  deliveries, and register the unclaimed-installation cleanup cron when Sentry is
  enabled.
- `@shipfox/client-integrations`: treat the retryable `verification-in-progress`
  response as a backoff-eligible failure on the connect callback.
