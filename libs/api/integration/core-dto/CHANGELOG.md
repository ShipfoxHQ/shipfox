# @shipfox/api-integration-core-dto

## 0.1.0

### Minor Changes

- 115655e: Moves source-event translation to the integration module: source-control providers emit a typed, provider-agnostic `INTEGRATION_SOURCE_COMMIT_PUSHED` event via one transactional publisher, projects subscribes to it instead of decoding GitHub payloads, and branch-deletion pushes are dropped at the source.
- b8e49ff: Add the client-side Sentry install/connect flow and a workspace settings
  integrations hub.
  - `@shipfox/client-integrations`: shared `IntegrationGallerySection` (capability
    filter, lifecycle pills, "Added" date, external link, connected-first
    ordering, degraded status mode), shared `RedirectInstallPage` powering the
    GitHub and new Sentry install pages, `SentryCallbackPage` with an explicit
    workspace confirm (sessionStorage only pre-selects), two-tier retry, and the
    Sentry hooks (`useCreateSentryInstallMutation`, `connectSentry`,
    `useIntegrationConnectionsQuery`).
  - `@shipfox/client-workspace-settings`: new `/workspaces/$wid/settings/integrations`
    page and an Integrations entry in the settings nav.
  - `@shipfox/client-router`: routes for the Sentry install page, the root-level
    Sentry callback, and the settings integrations page.
  - `@shipfox/react-ui`: `sentry` icon (monochrome, theme-aware).
  - `@shipfox/api-integration-core-dto`: optional `external_url` on the connection
    DTO and an optional `connectionExternalUrl` method on `IntegrationProvider`.
  - `@shipfox/api-integration-core`: `GET /integration-connections` now returns
    connections of every lifecycle status (the active-only filter prevented
    clients from surfacing disabled/error state) and resolves `external_url`
    per connection best-effort.
  - `@shipfox/api-integration-sentry` / `@shipfox/api-integration-github`:
    implement `connectionExternalUrl` (Sentry org URL via a new
    by-connection-id installation lookup; GitHub installation settings URL).

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
- f8f339a: Add the `@shipfox/redact` package with shared credential-redaction helpers: `redactUrlCredentials` (scheme-agnostic free-text scrubber), `stripUrlCredentials` (structured single-URL stripper), `redactSecrets` (literal-secret scrubber), and the `REDACTION_PLACEHOLDER` constant. Move `redactCheckoutSpec` from `@shipfox/api-integration-core-dto` into `@shipfox/api-integration-core` so it can reuse the shared `stripUrlCredentials` without breaking the dto-only-dependency rule; its public export path (`@shipfox/api-integration-core`) is unchanged. No behavior change.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
