# ClickUp integration provider

ClickUp OAuth connection flow, persistence, scoped token storage, provider wiring, and E2E connection setup.

## What it does

- **`createClickUpIntegrationProvider`** creates the ClickUp provider with connection cleanup hooks.
- **`createClickUpTokenStore`** stores and reads ClickUp access tokens and per-webhook secrets.
- **Installation persistence** stores one configured ClickUp workspace for each Shipfox connection.
- **`createClickUpE2eRoutes`** exposes the protected synthetic connection route used by E2E suites.

The provider exposes the authenticated OAuth install and callback routes. Webhook delivery and agent tools build on this connection flow.

## Installation and setup

Add the package as a workspace dependency:

```json
{
  "dependencies": {
    "@shipfox/api-integration-clickup": "workspace:*"
  }
}
```

The application enables the provider through the core integration module. The provider is disabled by default.

## Usage

```ts
import {createClickUpIntegrationProvider} from '@shipfox/api-integration-clickup';

const provider = createClickUpIntegrationProvider();

console.log(provider.displayName);
```

The application supplies the cleanup functions and scoped secrets adapter during module composition.

## Environment

Configuration is defined in [`src/config.ts`](src/config.ts). Required OAuth and webhook URLs have no defaults. The API and authorization URLs have ClickUp defaults and support test-server overrides.

## Routes

The E2E route group mounts `POST /__e2e/integrations/clickup-connections` when E2E routes are enabled. It creates a connection and installation, then stores the access token and webhook secret without returning either secret.

## Data model

The `integrations_clickup_installations` table stores the connection, configured ClickUp workspace, authorizing user, webhook ID, status, and timestamps. `connection_id` and `team_id` are unique. The migration history uses `__drizzle_migrations_integrations_clickup`.

## Development

The persistence tests require the repository PostgreSQL test database.

```sh
mise exec -- turbo check type test --filter=@shipfox/api-integration-clickup...
mise exec -- turbo build --filter=@shipfox/api-integration-clickup
```

## License

MIT
