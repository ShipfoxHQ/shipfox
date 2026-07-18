# @shipfox/api-integration-core

## 4.0.0

### Minor Changes

- 67176d4: Adds the Slack OAuth connection flow with provider routes, secure bot-token storage, and E2E setup.

### Patch Changes

- 5d129d6: Adds the default-off Jira provider scaffold with installation storage and token custody seams.
- bbba3b7: Adds the Slack integration provider scaffold with installation storage, bot-token custody, and flag-gated registration.
- 1951293: Adds in-process Slack agent tools for reading conversations and acting on messages through the lease-authenticated gateway.
- Updated dependencies [0745ee9]
- Updated dependencies [23c8e4d]
- Updated dependencies [67176d4]
- Updated dependencies [7267872]
- Updated dependencies [bbba3b7]
- Updated dependencies [1951293]
  - @shipfox/api-integration-slack@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-integration-linear@4.0.0
  - @shipfox/api-integration-jira@4.0.0
  - @shipfox/api-integration-gitea@4.0.0
  - @shipfox/api-integration-github@4.0.0
  - @shipfox/api-integration-sentry@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [6b23868]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/api-integration-github@3.0.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/api-integration-sentry@3.0.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-integration-gitea@3.0.0
  - @shipfox/api-integration-linear@3.0.0
  - @shipfox/api-integration-webhook@3.0.0
  - @shipfox/api-agent-dto@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 0cd6dd4: Adds stoppable module workers and declarative module startup tasks for server composition.
- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [a68458a]
- Updated dependencies [6eba800]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-integration-gitea@2.0.0
  - @shipfox/api-integration-github@2.0.0
  - @shipfox/api-integration-linear@2.0.0
  - @shipfox/api-integration-sentry@2.0.0
  - @shipfox/api-integration-webhook@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1
  - @shipfox/redact@0.2.1
  - @shipfox/regex@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/node-module@0.1.2
  - @shipfox/api-integration-linear@1.0.2
  - @shipfox/api-integration-github@0.1.2
  - @shipfox/api-integration-sentry@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [68b8d03]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/redact@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-integration-gitea@0.0.2
  - @shipfox/api-integration-github@0.1.1
  - @shipfox/api-integration-linear@1.0.1
  - @shipfox/api-integration-sentry@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- 115655e: Moves source-event translation to the integration module: source-control providers emit a typed, provider-agnostic `INTEGRATION_SOURCE_COMMIT_PUSHED` event via one transactional publisher, projects subscribes to it instead of decoding GitHub payloads, and branch-deletion pushes are dropped at the source.
- d245be8: [api/integrations] Make the signed Sentry installation webhook authoritative.
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

- 0948b67: Scaffolds the Linear integration provider, package pair, config, and installation store behind the core provider flag.
- a68ed61: Restructures the integrations composition root so each provider owns its loader, adapter wiring, and migrations-table name in one file under `src/providers/`, registered through a single list; no behavior change.
- ce062a9: Validates authored agent step integrations against provider tool catalogs and workspace connection capabilities.
- f3614ae: Add `createCheckoutSpec()` to the integration source-control service and the GitHub provider. GitHub mints a short-lived, repo-scoped installation access token and returns it as structured `CheckoutCredentials` alongside a clean `repositoryUrl`; the secret is never embedded in the URL. `ref` defaults to the repository default branch, providers without checkout support raise a typed `IntegrationCheckoutUnsupportedError`, and a `redactCheckoutSpec()` helper masks the token for logging. Dormant until the checkout-token endpoint and runner enrichment are wired in; no runtime behavior changes yet.
- f98c2be: [api/workflows] Add the lease-authed `POST /runs/jobs/current/checkout-token` endpoint. The runner exchanges its job lease for short-lived, read-only repository checkout credentials. The job's checkout intent is resolved server-side from the authoritative `jobId` claim (`job -> run -> project` source metadata) and minted on demand via the integration service's `createCheckoutSpec()`; no credential material is ever stored on the job/run or queued. `checkoutTokenResponseSchema.auth` stays optional so credential-free providers can return a public clone URL with no token, and `integrationRouteErrorHandler` is exported from `@shipfox/api-integration-core` so the route reuses the shared provider-error mapping.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- f8f339a: Add the `@shipfox/redact` package with shared credential-redaction helpers: `redactUrlCredentials` (scheme-agnostic free-text scrubber), `stripUrlCredentials` (structured single-URL stripper), `redactSecrets` (literal-secret scrubber), and the `REDACTION_PLACEHOLDER` constant. Move `redactCheckoutSpec` from `@shipfox/api-integration-core-dto` into `@shipfox/api-integration-core` so it can reuse the shared `stripUrlCredentials` without breaking the dto-only-dependency rule; its public export path (`@shipfox/api-integration-core`) is unchanged. No behavior change.
- 58f51bd: Scaffold an empty `gitea` integration provider that mirrors the `github` package structure, ahead of any behavior.
  - New `@shipfox/api-integration-gitea` + `@shipfox/api-integration-gitea-dto` packages: `createGiteaIntegrationProvider()` returns an empty provider (`{provider: 'gitea', displayName: 'Gitea', adapters: {}, routes: []}`), plus a `src/config.ts` documenting the self-hoster variables (`GITEA_BASE_URL`, `GITEA_SERVICE_USERNAME`, `GITEA_SERVICE_TOKEN`, `GITEA_WEBHOOK_SECRET`, `GITEA_WEBHOOK_TARGET_URL`, `GITEA_CHECKOUT_TTL_SECONDS`) and an empty provider database wired with the stable migrations table `__drizzle_migrations_integrations_gitea`.
  - `@shipfox/api-integration-core`: register the Gitea provider behind `INTEGRATIONS_ENABLE_GITEA_PROVIDER` (default false). With the flag enabled, `gitea` appears in `GET /integration-providers`. Dormant scaffold; no runtime behavior yet.

- 570ac69: Add the Gitea connection flow so a workspace member can link a Gitea org with a single authenticated request (no OAuth, no redirect).
  - `@shipfox/api-integration-gitea-dto`: `createGiteaConnectionBodySchema` (`{workspace_id, org}`); the response reuses the shared `integrationConnectionDtoSchema`.
  - `@shipfox/api-integration-gitea`: `POST /integrations/gitea/connections` (`AUTH_USER`, workspace membership) canonicalizes the org to lower case (Gitea routes org names case-insensitively, so this keeps the case-sensitive ownership lookup and unique indexes from being bypassed by a case variant), validates the org via the API, rejects an org already linked to another workspace (409), registers an org-level push webhook (`POST /orgs/{org}/hooks` with `GITEA_WEBHOOK_SECRET`/`GITEA_WEBHOOK_TARGET_URL`), and in one transaction upserts the core connection (`provider: 'gitea'`, `externalAccountId: org`) and a new `integrations_gitea_connections` row (`connection_id`/`org` unique, stored `webhook_id`). Re-connecting an already-active org is idempotent and skips a second webhook. Webhook registration itself is idempotent (an existing org hook for the target URL is reused) and compensated (a hook created before a transaction that then rolls back is deleted), so concurrent or retried connects do not leave orphaned hooks. The `GiteaApiClient` gains `organizationExists`, `createOrgPushWebhook`, and `deleteOrgWebhook`, and the provider exposes `connectionExternalUrl` pointing at the org on the Gitea instance.
  - `@shipfox/api-integration-core`: wire the Gitea connect closure (`connectGiteaConnection`) and the cross-tenant lookup (`getExistingGiteaConnection`) into the provider, mirroring `connectGithubInstallation`.

  Connecting an org creates an active connection visible in `GET /integration-connections` and registers a Gitea webhook whose id is stored.

- 857fd73: Receive Gitea push webhooks and trigger runs through the existing source-push pipeline.
  - `@shipfox/api-integration-gitea-dto`: `giteaPushPayloadSchema` (`{ref, after, repository: {name, full_name, default_branch, owner: {username}}}`).
  - `@shipfox/api-integration-gitea`: `POST /webhooks/integrations/gitea` (`auth: []`, `rawBodyPlugin`, standard webhook body limit). It verifies the `X-Gitea-Signature` header as hex HMAC-SHA256 of the raw body keyed by `GITEA_WEBHOOK_SECRET` (401 on mismatch), records non-`push` events for delivery dedup and returns 204, and on a `push` resolves the org (`repository.owner.username`, lower-cased to match the stored org) to its connection, drops branch deletions and unknown orgs, and publishes a normalized `SourcePushPayload` (`externalRepositoryId: gitea:<owner>/<repo>` built from `owner.username`/`repository.name` to match the source-control adapter, `refs/heads/` stripped, `headCommitSha: after`, `isDefaultBranch`). `getGiteaConnectionByOrg` gains an optional transaction executor so the lookup runs inside the publishing transaction. The webhook is registered out of band by the Gitea instance admin, so the connect flow registers nothing.
  - `@shipfox/api-integration-core`: wire `publishSourcePush`, `recordDeliveryOnly`, `getIntegrationConnectionById`, and the core database into the Gitea provider, mirroring GitHub.
  - `@shipfox/node-fastify`: add a shared `verifyHexHmacSignature` helper for hex HMAC-SHA256 webhook signatures.
  - `@shipfox/api-integration-sentry`: `verifySentrySignature` now delegates to the shared helper.

  A push to a connected org's repo creates a workflow run through the existing pipeline. Duplicate POSTs of the same delivery are deduped via `X-Gitea-Delivery`; note that a manual "Redeliver" in Gitea mints a new delivery id and intentionally produces a fresh run (unlike GitHub, whose redelivery reuses the original id and is suppressed).

- 444ac89: Enables the generic webhook integration provider by default because it does not require provider setup.
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

- 417f128: Move the Sentry unclaimed-installation cleanup cron out of `@shipfox/api-integration-core` into `@shipfox/api-integration-sentry`, which now owns its own Temporal maintenance worker. `core` aggregates per-integration workers from enabled providers instead of special-casing Sentry, keeping the integration dependency graph a tree (providers depend only on `*-core-dto`, never on `core`). The unclaimed-installation retention window is now configurable via `SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS` (default 7, minimum 1; startup fails on a smaller value so a misconfiguration cannot tombstone freshly created installs).
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- 8b9c3e0: Runs the API runners and integration core test suites without per-file Vitest module isolation, removing runner auth-helper mocks and cleaning up module-reset handling for shared test modules.
- Updated dependencies [067a260]
- Updated dependencies [43d7996]
- Updated dependencies [0948b67]
- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [de54da2]
- Updated dependencies [ce062a9]
- Updated dependencies [8958753]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [5bcdbf4]
- Updated dependencies [f3614ae]
- Updated dependencies [9f1c0ef]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [360d06d]
- Updated dependencies [f8f339a]
- Updated dependencies [58f51bd]
- Updated dependencies [75f2cc8]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [0667cce]
- Updated dependencies [aca162b]
- Updated dependencies [75520ff]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [6297b06]
- Updated dependencies [01be723]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
- Updated dependencies [282e66a]
- Updated dependencies [9c149d1]
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/api-integration-linear@1.0.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-integration-github@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/regex@0.2.0
  - @shipfox/api-integration-sentry@0.1.0
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/redact@0.1.0
  - @shipfox/api-integration-gitea@0.0.1
  - @shipfox/api-integration-webhook@0.0.1
  - @shipfox/config@1.2.0
