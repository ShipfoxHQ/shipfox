---
"@shipfox/client-integrations": minor
"@shipfox/client-workspace-settings": minor
"@shipfox/client-router": minor
"@shipfox/react-ui": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-sentry": minor
"@shipfox/api-integration-github": minor
---

Add the client-side Sentry install/connect flow and a workspace settings
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
