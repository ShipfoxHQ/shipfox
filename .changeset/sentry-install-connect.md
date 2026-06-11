---
"@shipfox/api-integration-sentry": minor
"@shipfox/api-integration-sentry-dto": minor
"@shipfox/api-integration-core": patch
---

Add the Sentry install/connect flow so a workspace member can link a Sentry
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
