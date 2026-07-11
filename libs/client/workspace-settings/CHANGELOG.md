# @shipfox/client-workspace-settings

## 0.1.0

### Minor Changes

- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- e51d464: Add the Secrets & Variables workspace settings UI (S1b).
  - New `@shipfox/client-secrets` package: transport + React Query hooks (a shared
    `createStoreApi` factory), a write-only secret form and a readable variable form
    (TanStack Form + Zod, multiline `Textarea` values, live short-value / sensitive-name
    advisories), and the workspace secrets/variables sections (single-call list, masked
    secret values, copy-name, delete with blast-radius warning).
  - `@shipfox/client-workspace-settings`: new Secrets and Variables settings pages and nav
    entries.
  - `@shipfox/api-secrets-dto`: export `SECRETS_MAX_LIST_LIMIT` and raise the list `limit`
    cap so the settings UI can fetch the whole bounded set in one request; the variable
    list item now carries `value_truncated`.
  - `@shipfox/api-secrets`: the variable list returns a bounded single-line preview of each
    value (the full value is read via `GET /variables/:key` when editing) so a single-call
    list cannot materialize very large responses; startup fails if `SECRETS_MAX_PER_WORKSPACE`
    exceeds the list limit.
  - `@shipfox/client-router`: register the `/workspaces/$wid/settings/secrets` and
    `/variables` routes.

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

- 0f06c02: Redesign the integration gallery into separate Installed and Available sections, rendering one card per connection so multiple connections from the same provider are no longer collapsed and silently hidden.
- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- 048fc29: Adds Runner Provisioners settings with provisioner token management and connection status.
- Updated dependencies [067a260]
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [d02c5fd]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [72ce351]
- Updated dependencies [2a3193f]
- Updated dependencies [1b9d909]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [d245be8]
- Updated dependencies [0f06c02]
- Updated dependencies [e4c6abf]
- Updated dependencies [e4c6abf]
- Updated dependencies [2c352bb]
- Updated dependencies [e5d2f13]
- Updated dependencies [5d0676a]
- Updated dependencies [a460020]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [42443b4]
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
- Updated dependencies [e51d464]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [f849131]
- Updated dependencies [a7da648]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [048fc29]
- Updated dependencies [6181819]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/client-agent@0.1.0
  - @shipfox/client-integrations@0.1.0
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-workspaces-dto@0.1.0
  - @shipfox/client-triggers@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
  - @shipfox/client-auth@0.0.3
  - @shipfox/client-secrets@0.1.0
  - @shipfox/client-runners@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [5c1e777]
  - @shipfox/react-ui@0.2.0
  - @shipfox/client-auth@0.0.2
  - @shipfox/client-runners@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [2311e15]
  - @shipfox/react-ui@0.1.1
  - @shipfox/client-auth@0.0.1
  - @shipfox/client-runners@0.0.1
  - @shipfox/api-workspaces-dto@0.0.0
  - @shipfox/client-api@0.0.0
