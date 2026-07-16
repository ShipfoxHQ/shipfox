# @shipfox/client-integrations

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-integration-gitea-dto@2.0.0
  - @shipfox/api-integration-github-dto@2.0.0
  - @shipfox/api-integration-linear-dto@2.0.0
  - @shipfox/api-integration-sentry-dto@2.0.0
  - @shipfox/api-integration-webhook-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-auth@0.0.4
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- 43d7996: Adds the Linear OAuth connect experience to workspace integration settings.
- e4c6abf: Add reusable, source-keyed icon building blocks so any surface can render an integration or trigger icon without re-implementing the catalog lookup and fallback.

  `@shipfox/client-integrations` exposes `getIntegrationIcon(source)` and `<IntegrationIcon source />`, resolving an integration source (a connection `provider`, a run `trigger_source`, or a trigger event `source`) against the central `PROVIDER_CATALOG` with a neutral `componentLine` fallback. The catalog stays the single place each integration declares its icon; the integration gallery now renders `<IntegrationIcon>` instead of an inline lookup (no behavior change).

  New `@shipfox/client-triggers` package adds `getTriggerSourceIcon(source)` and `<TriggerSourceIcon source />`, built on the integration resolver. It recognizes the system trigger sources `manual` (a person fired the run) and `cron` (a schedule), and delegates every other source to the integration catalog. This is the building block for showing an icon on run rows and trigger events; adopting it on those surfaces lands separately.

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

### Patch Changes

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

- 0f06c02: Redesign the integration gallery into separate Installed and Available sections, rendering one card per connection so multiple connections from the same provider are no longer collapsed and silently hidden.
- 42443b4: Redesign the projects hub cards around source health and align them with the
  integration gallery cards. Each card now shows the integration provider logo
  before the name, drops the raw external repository id, and surfaces a status
  pill only when the project's source is not active (Disabled or Error), in the
  same inline location as the gallery. The cards adopt the gallery layout
  (two-column grid, 16px padding, 24px icon) and carry no call to action.

  Extract the connection lifecycle pill into a shared `ConnectionStatusBadge` in
  `@shipfox/client-integrations` so the gallery and the projects hub render the
  same taxonomy from one source of truth.

- 63bcac8: Moves workspace setup gating into route hooks so VCS onboarding and first project creation resolve before protected workspace content renders.
- a7da648: Fixes invisible keyboard focus rings on the user menu, integration tiles, and project cards by using the existing neutral button focus token.
- Updated dependencies [43d7996]
- Updated dependencies [0948b67]
- Updated dependencies [14e0bea]
- Updated dependencies [861091c]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [115655e]
- Updated dependencies [2a3193f]
- Updated dependencies [ce062a9]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [f3614ae]
- Updated dependencies [d245be8]
- Updated dependencies [f8f339a]
- Updated dependencies [e4c6abf]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [5d0676a]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [24f131b]
- Updated dependencies [7790355]
- Updated dependencies [bb2a7bc]
- Updated dependencies [63bcac8]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [d6d4862]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [01be723]
- Updated dependencies [f849131]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-integration-linear-dto@0.0.1
  - @shipfox/api-integration-webhook-dto@0.0.1
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-integration-sentry-dto@0.1.0
  - @shipfox/api-integration-gitea-dto@0.0.1
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
  - @shipfox/client-auth@0.0.3
  - @shipfox/api-integration-github-dto@0.0.1

## 0.0.2

### Patch Changes

- Updated dependencies [5c1e777]
  - @shipfox/react-ui@0.2.0
  - @shipfox/client-auth@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [2311e15]
  - @shipfox/react-ui@0.1.1
  - @shipfox/client-auth@0.0.1
  - @shipfox/api-integration-core-dto@0.0.0
  - @shipfox/api-integration-github-dto@0.0.0
  - @shipfox/client-api@0.0.0
