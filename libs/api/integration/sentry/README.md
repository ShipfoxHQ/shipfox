# Shipfox API Integration Sentry

Shipfox API Integration Sentry receives Sentry App webhooks and publishes
normalized integration events for downstream modules such as triggers and
projects. It also exposes the install/connect flow that links a Sentry
installation to a Shipfox workspace.

## Setup

This package is private to the workspace. Enable the provider from the
integrations core package with:

```sh
INTEGRATIONS_ENABLE_SENTRY_PROVIDER=true
```

Configure the Sentry App credentials in the API environment:

```sh
SENTRY_APP_CLIENT_ID=
SENTRY_APP_CLIENT_SECRET=
SENTRY_APP_SLUG=
SENTRY_APP_VERIFY_INSTALL=true
```

`SENTRY_APP_CLIENT_SECRET` is the shared secret used to verify inbound webhooks with HMAC-SHA256 (Sentry signs deliveries with it, the provider verifies them).

## Webhook Route

The provider mounts this unauthenticated webhook route:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/webhooks/integrations/sentry` | Receives Sentry App webhooks. |

The route verifies the request signature before parsing JSON. It deduplicates
deliveries by Sentry's `Request-ID` header. Malformed JSON, unknown actions,
unknown resources, and events for unknown installations are recorded and
acknowledged with `204` so Sentry does not disable the webhook after repeated
non-2xx responses.

## Events

Issue webhooks publish `INTEGRATION_EVENT_RECEIVED` with `source: 'sentry'`.
Downstream trigger payloads receive the normalized `SentryIssuePayload` in
`triggerPayload.data`.

| Event | Sentry issue action |
| --- | --- |
| `issue.created` | `created` |
| `issue.resolved` | `resolved` |
| `issue.assigned` | `assigned` |
| `issue.archived` | `archived` |
| `issue.unresolved` | `unresolved` |

A raw Sentry `ignored` action is normalized to `issue.archived` with
`payload.action: 'archived'`.

## Install / Connect Routes

The provider mounts these authenticated routes (`AUTH_USER` bearer token):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/integrations/sentry/install` | Returns the Sentry external-install URL for a workspace. |
| `POST` | `/integrations/sentry/connect` | Links a Sentry installation to a workspace after the install redirect. |

Sentry has no `state` parameter in its install redirect, so the workspace is
taken from the request body (`workspace_id`) and authorized against the live
session. `POST /connect` accepts `{workspace_id, code, installation_id}` only —
the organization slug is derived from Sentry after the code exchange, never
trusted from the client. The exchanged token is used in-memory for the optional
verify-install call and then discarded; **no Sentry token is persisted**.

## Sentry App registration

Configure the Sentry App (Settings → Developer Settings → your app):

- **Redirect URL:** point it at the client callback route
  `<client-origin>/integrations/sentry/callback` (for example
  `https://app.shipfox.io/integrations/sentry/callback`, or
  `http://localhost:5173/integrations/sentry/callback` for local development).
  The page reads `code`, `installationId`, and `orgSlug` from the redirect
  query, asks the user to confirm the target workspace, and calls
  `POST /integrations/sentry/connect`. This is per-environment configuration:
  each environment's Sentry App must point at that environment's client
  origin, or installs end on sentry.io with nowhere to return to.
- **Webhooks:** enable the **Issue** resource so issue webhooks are delivered.
- **Verify Install:** when enabled, the connect flow issues a
  `PUT /api/0/sentry-app-installations/{installation_id}/` to mark the
  installation installed; mirror the toggle with `SENTRY_APP_VERIFY_INSTALL`.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-integration-sentry
turbo type --filter=@shipfox/api-integration-sentry
turbo test --filter=@shipfox/api-integration-sentry
```

Tests use Vitest and a real PostgreSQL database. Start local services before
running the test suite:

```sh
docker compose up -d
```

The test environment uses the `api_test` database, set in `test/env.ts`.

## License

MIT
