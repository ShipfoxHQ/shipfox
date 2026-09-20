# Notion integration provider

Notion provider persistence, scoped token storage, provider wiring, and E2E connection setup.

## What it does

- **`createNotionIntegrationProvider`** creates the flag-gated Notion provider without user-facing routes or adapters.
- **`createNotionTokenStore`** stores and reads Notion access and refresh tokens through scoped secrets.
- **Installation persistence** stores one Notion workspace installation for each Shipfox connection.
- **`createNotionE2eRoutes`** exposes the protected synthetic connection route used by E2E suites.

OAuth, webhooks, token refresh, and tools build on this scaffold in later provider work.

## Installation and setup

Add the package as a workspace dependency:

```json
{
  "dependencies": {
    "@shipfox/api-integration-notion": "workspace:*"
  }
}
```

The application enables the provider through `INTEGRATIONS_ENABLE_NOTION_PROVIDER`. The provider is disabled by default.

## Usage

```ts
import {createNotionIntegrationProvider} from '@shipfox/api-integration-notion';

const provider = createNotionIntegrationProvider();

console.log(provider.displayName);
```

The application supplies the cleanup functions and scoped secrets adapter during module composition.

## Environment

Configuration is defined in [`src/config.ts`](src/config.ts). OAuth settings are required for the later connect flow. The webhook verification token is optional so Notion can send its initial handshake. The API base URL defaults to Notion and supports E2E overrides.

## Routes

The E2E route group mounts `POST /__e2e/integrations/notion-connections` when E2E routes are enabled. It creates a connection and installation, then stores the access token without returning it.

## Data model

The `integrations_notion_installations` table stores the connection, Notion workspace, workspace name, bot ID, authorizing Shipfox user, token expiry, status, and timestamps. `connection_id` and `notion_workspace_id` are unique. The migration history uses `__drizzle_migrations_integrations_notion`.

## Development

The persistence tests require the repository PostgreSQL test database.

```sh
mise exec -- turbo check type test --filter=@shipfox/api-integration-notion...
mise exec -- turbo build --filter=@shipfox/api-integration-notion
```

## License

MIT
