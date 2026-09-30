# Discord integration

`@shipfox/api-integration-discord` provides the config-gated Discord provider scaffold, guild installation persistence, and E2E connection seed route used by later Discord features.

## What it does

- **`createDiscordIntegrationProvider`** exposes the Discord provider metadata, guild external URL, and connection-record cleanup hook.
- **Installation repository exports** create, find, and delete Discord guild installations owned by the provider database.
- **`createDiscordE2eRoutes`** exposes the synthetic connection route used by integration and E2E tests.
- **`config`** defines the Discord application, OAuth, bot, Gateway, and API settings.

## Installation and setup

Add the package as a workspace dependency:

```json
{
  "dependencies": {
    "@shipfox/api-integration-discord": "workspace:*"
  }
}
```

The application composition root registers the provider through the integrations core module. Keep the provider flag disabled until the Discord implementation is ready for the target environment.

## Usage

```ts
import {createDiscordIntegrationProvider} from '@shipfox/api-integration-discord';

const provider = createDiscordIntegrationProvider({
  getDiscordInstallationByConnectionId: async () => undefined,
});

console.log(provider.provider); // discord
```

## Environment

The executable environment contract is defined in [`src/config.ts`](src/config.ts). The provider reads these settings when enabled:

| Variable | Purpose |
| --- | --- |
| `INTEGRATIONS_ENABLE_DISCORD_PROVIDER` | Enables the provider. |
| `DISCORD_APPLICATION_ID` | Discord application and OAuth client ID. |
| `DISCORD_OAUTH_CLIENT_SECRET` | OAuth code exchange and state signing secret. |
| `DISCORD_OAUTH_REDIRECT_URL` | Discord OAuth callback URL. |
| `DISCORD_PUBLIC_KEY` | Interaction signature verification key. |
| `DISCORD_BOT_TOKEN` | Bot token for Discord API access. |
| `DISCORD_GATEWAY_ENABLED` | Enables the Gateway service when it is implemented. |
| `DISCORD_API_BASE_URL` | Discord API base URL, including E2E overrides. |

## Routes

`createDiscordE2eRoutes` registers `POST /integrations/discord-connections` under the E2E route prefix. It accepts the Discord DTO seed body and returns the integration connection DTO. This route is for test setup, not production clients.

## Data model

The package owns the `integrations_discord` database namespace and its `integrations_discord_installations` and `integrations_discord_gateway_sessions` tables. A guild and connection each have a unique installation row. Reinstalling the same guild for the same connection updates the installation and increments `generation`, which later lifecycle checks use for compare-and-set ordering. Deleting a connection removes the provider row so the guild can be seeded or installed again.

The sessions table holds one row per Gateway shard: `session_id`, `resume_gateway_url`, `received_sequence`, and `committed_sequence`. `committed_sequence` is the only resume point. `received_sequence` is diagnostics only, because the Gateway library advances it before a handler publishes. The repository reads the row when a leader starts, writes a new session at once, and flushes the session fields and both cursors in one write. Within one session the committed cursor never goes down. Keep the library hooks in memory and flush on a timer, not on every dispatch.

## Development

Run these commands from the repository root:

```sh
mise exec -- turbo check type test depcruise --filter=@shipfox/api-integration-discord...
mise exec -- pnpm check:api-database-boundaries
mise exec -- pnpm check:api-migrations
```

The persistence tests use the repository PostgreSQL test service. Start it with `mise exec -- pnpm dev:services:up` when it is not already running.

## License

MIT
