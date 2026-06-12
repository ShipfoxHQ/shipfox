# @shipfox/api-integration-core

## 0.1.0

### Minor Changes

- d6d4862: Add a Sentry integration provider that ingests issue webhooks.
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

### Patch Changes

- f3614ae: Add `createCheckoutSpec()` to the integration source-control service and the GitHub and Debug providers. GitHub mints a short-lived, repo-scoped installation access token and returns it as structured `CheckoutCredentials` alongside a clean `repositoryUrl` (the secret is never embedded in the URL); Debug returns its static clone URL with no credentials. `ref` defaults to the repository default branch, providers without checkout support raise a typed `IntegrationCheckoutUnsupportedError`, and a `redactCheckoutSpec()` helper masks the token for logging. Dormant until the checkout-token endpoint and runner enrichment are wired in; no runtime behavior changes yet.
- 5b8ed32: Add the Sentry install/connect flow so a workspace member can link a Sentry
  installation to a Shipfox workspace, writing the connection + installation rows
  that the webhook receiver looks up.
  - `@shipfox/api-integration-sentry`: add a stateless `SentryApiClient`
    (authorization-code exchange, org-slug derivation, optional verify-install),
    `handleSentryConnect`, and two authenticated routes —
    `POST /integrations/sentry/install` (returns the external-install URL) and
    `POST /integrations/sentry/connect` (links the installation). Sentry has no
    `state` param, so the workspace is taken from the request body and authorized
    against the live session; the org slug is derived from Sentry, never trusted
    from the body. The verify-install side effect runs after the row is persisted,
    and no Sentry token is stored. Provider HTTP errors map to a typed
    `SentryIntegrationProviderError` and never carry the token, code, or client
    secret.
  - `@shipfox/api-integration-sentry-dto`: add the install/connect request and
    response schemas.
  - `@shipfox/api-integration-core`: wire the `getExistingSentryConnection` and
    `connectSentryInstallation` closures into the Sentry provider (internal
    wiring, no public API change).

  A concurrent same-install connect race (shared with GitHub) is tracked
  separately in ENG-409.

- Updated dependencies [c0a883c]
- Updated dependencies [e47f8da]
- Updated dependencies [f3614ae]
- Updated dependencies [5b8ed32]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-integration-github@0.0.1
  - @shipfox/api-integration-debug@0.0.1
  - @shipfox/api-integration-sentry@0.1.0
  - @shipfox/node-module@0.1.0
  - @shipfox/api-workspaces@0.0.1
  - @shipfox/node-drizzle@0.0.1
  - @shipfox/node-outbox@0.0.1
