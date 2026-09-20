# PostHog integration

PostHog provider contracts, installation persistence, and credential storage for the PostHog integration.

## What it does

- **PostHog provider** registers PostHog without capabilities until its adapters ship.
- **PosthogInstallation** stores the project metadata and credential version for one connection.
- **PosthogCredentialStore** stores API keys in the secrets module.
- **PostHog E2E route** creates seeded connections for integration tests.

## Installation and setup

Add the workspace package to an API integration package:

```json
{
  "dependencies": {
    "@shipfox/api-integration-posthog": "workspace:*"
  }
}
```

The provider is disabled by default. Set `INTEGRATIONS_ENABLE_POSTHOG_PROVIDER=true` to register it.

## Usage

```ts
import {
  createPosthogCredentialStore,
  posthogSecretsNamespace,
} from '@shipfox/api-integration-posthog';

const store = createPosthogCredentialStore({resolveConnection, secrets});
await store.setApiKey({connectionId, apiKey: 'phx_example'});
const namespace = posthogSecretsNamespace(connectionId);
```

## Environment

The shared integrations configuration owns `INTEGRATIONS_ENABLE_POSTHOG_PROVIDER`.

## Data model

The package owns the `integrations_posthog_installations` migration unit. It stores project metadata, the last four characters of the key, and a credential version. The API key is never stored in PostgreSQL.

## Behavior notes

Credential version checks lock the installation row and run the caller callback in the same transaction. A stale callback cannot update a connection after its key has been replaced.

## Development

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-posthog
mise exec -- turbo type --filter=@shipfox/api-integration-posthog
mise exec -- turbo test --filter=@shipfox/api-integration-posthog
```

The test suite uses the repository PostgreSQL service.

## License

MIT
