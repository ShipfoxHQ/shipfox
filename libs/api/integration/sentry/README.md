# Shipfox API Integration Sentry

Shipfox API Integration Sentry receives Sentry App webhooks and publishes
normalized integration events for downstream modules such as triggers and
projects.

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

`SENTRY_APP_CLIENT_SECRET` signs inbound webhooks with HMAC-SHA256.

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
