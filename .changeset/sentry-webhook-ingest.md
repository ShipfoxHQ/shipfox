---
"@shipfox/api-integration-sentry-dto": minor
"@shipfox/api-integration-sentry": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/node-fastify": minor
"@shipfox/node-module": minor
"@shipfox/api-integration-github": patch
---

Add a Sentry integration provider that ingests issue webhooks (PR1 of 2).

- New `@shipfox/api-integration-sentry` + `-sentry-dto` packages: a webhook
  receiver that verifies the HMAC-SHA256 signature (keyed with the app client
  secret), dedups on `Request-ID`, normalizes the issue payload, and publishes
  `integrations.event.received` with `source: 'sentry'` and `event:
  issue.<action>`. A raw `ignored` action is normalized to `archived`. Malformed,
  bad-JSON, unknown-action, and unknown-resource deliveries are recorded-and-dropped
  with a 204 (deliberate deviation from GitHub's 400 to avoid Sentry disabling the
  webhook).
- `@shipfox/api-integration-core-dto`: add the `SentryIssuePayload` contract.
- `@shipfox/api-integration-core`: register the Sentry provider behind
  `INTEGRATIONS_ENABLE_SENTRY_PROVIDER`, add the
  `updateIntegrationConnectionLifecycleStatus` helper, and pin stable
  migration-tracking table names per provider database.
- `@shipfox/node-fastify`: add the shared `rawBodyPlugin` and `WEBHOOK_BODY_LIMIT`
  exports for webhook receivers.
- `@shipfox/node-module`: add an optional `migrationsTableName` to `ModuleDatabase`
  so conditionally-composed databases get a position-independent migration table.
- `@shipfox/api-integration-github`: consume the shared `rawBodyPlugin` instead of
  a local copy (internal refactor, no behavior change).

Deploy note: environments with GitHub enabled must rename the existing
`__drizzle_migrations_integrations_1` table to
`__drizzle_migrations_integrations_github` as part of this release, or GitHub
migrations re-run against existing tables.
