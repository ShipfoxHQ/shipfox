# Discord integration

`@shipfox/api-integration-discord` provides the config-gated Discord provider scaffold, guild installation persistence, and E2E connection seed route used by later Discord features.

## What it does

- **`createDiscordIntegrationProvider`** exposes the Discord provider metadata, guild external URL, and the connection cleanup hooks. Deletion runs under the per-guild advisory lock `integrations:discord:guild:<guild_id>` (`withDiscordGuildLock`, 30 s bounded wait), and once the records commit the bot leaves the guild. A `403` or `404` from Discord counts as done, and any other failure is logged.
- **Installation repository exports** create, find, and delete Discord guild installations owned by the provider database.
- **`createDiscordWebhookRoutes` and `createDiscordWebhookProcessor`** receive Discord interactions, verify them, and publish command events.
- **`createDiscordE2eRoutes`** exposes the synthetic connection route used by integration and E2E tests.
- **`createDiscordGatewayService`** returns the `ModuleService` that elects one Gateway leader per shard with a Postgres advisory lock. Each replica holds a dedicated connection, retries every 10 s, and checks it with `SELECT 1` every 15 s. The `onLeading` and `onLost` callbacks carry the leader's work; `onLost` runs before the lock is released on shutdown.
- **`createDiscordApiClient`** calls the Discord REST API as the bot and maps failures to `DiscordIntegrationProviderError`.
- **`createDiscordGateway`** returns the Gateway `ModuleService`: the leader election with the shard connection as the leader's work. It connects with `@discordjs/ws`, resumes from the stored committed cursor, and identifies through an Identify guard.
- **`DiscordAgentToolsProvider`** serves the agent tools as the bot. The provider registers it as the `agent_tools` adapter, and `@shipfox/api-integration-discord/agent-tools` exports the catalog for the docs and action-type generators. It offers `read_channel`.
- **`registerDiscordCommands`** compares the application's registered commands with the `/shipfox` and "Send to Shipfox" definitions from `discord-dto` and overwrites them only on a difference. The integrations module runs it as a startup task on every replica.
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
| `DISCORD_GATEWAY_ENABLED` | Starts the Gateway service, which elects one leader per shard and connects it to Discord. Keep it off in shared environments until message and reaction ingestion are deployed. |
| `DISCORD_API_BASE_URL` | Discord API base URL, including E2E overrides. |

## Routes

`POST /webhooks/integrations/discord/interactions` receives Discord interactions (route id `discord.interaction`). The processor runs these steps in order:

1. A request without `x-signature-ed25519` and `x-signature-timestamp` gets `401`.
2. The Ed25519 signature over `timestamp + rawBody` must match `DISCORD_PUBLIC_KEY`, or the request gets `401`.
3. The timestamp must be within 300 seconds of the stored request's `received_at`, in either direction, or the request gets `401`. Discord signs a request once and the signature never expires, so this window is what stops a replay after the 30-day delivery records are pruned.
4. A body that is not a valid interaction gets `400`.
5. PING (`type` 1) is answered with `{"type": 1}`.
6. The `shipfox` slash command and the `Send to Shipfox` message command publish `slash_command` or `message_command` with the interaction id as the delivery id. The interaction `token` is removed from the payload.
7. Any other interaction gets an ephemeral "This action is not supported."

Commands are answered with an ephemeral message. It says the server is not connected when the guild has no active connection, warns that replies may not appear when `app_permissions` lacks `VIEW_CHANNEL` or `SEND_MESSAGES` (`SEND_MESSAGES_IN_THREADS` in a thread), and otherwise says "Working on it."

`createDiscordE2eRoutes` registers `POST /integrations/discord-connections` under the E2E route prefix. It accepts the Discord DTO seed body and returns the integration connection DTO. This route is for test setup, not production clients.

## REST client

`createDiscordApiClient()` reads `DISCORD_BOT_TOKEN`, `DISCORD_API_BASE_URL`, and `DISCORD_APPLICATION_ID` from `config`. Pass options to override them. It exposes `getGuild`, `getChannel`, `listChannelMessages`, `leaveGuild`, `getGatewayBot`, `listApplicationCommands`, and `overwriteApplicationCommands`.

Requests time out after 10 seconds and are never retried, because Discord counts `401`, `403`, and `429` answers toward an IP-wide block. Failures throw `DiscordIntegrationProviderError`:

| Discord answer | `reason` |
| --- | --- |
| `401` | `credentials-unavailable` |
| `403` | `access-denied`, with `discordCode` such as `50001` or `50013` |
| `404` | `not-found` |
| `429` | `rate-limited`, with `retryAfterSeconds` from `retry_after` |
| `5xx`, network failure | `provider-unavailable` |
| Timeout | `timeout` |
| Other `4xx` | `provider-rejected` |

## Agent tools

`openSession()` loads the installation for the connection and fails with `credentials-unavailable` when it is missing or `removed`. Arguments are validated against the catalog `inputSchema`, and failures come back as tool results:

| Failure | Tool result `code` |
| --- | --- |
| Discord `401` | `credentials-unavailable`, reported to Sentry because the deployment token is broken |
| Discord `403` | `access-denied`, naming the channel and the permission the bot probably lacks |
| Discord `404` | `not-found`, "Not found in this server" |
| Discord `429` | `rate-limited`, with `retryAfterSeconds` |
| Timeout, `5xx` | `provider-unavailable` |

The bot token reaches every server the bot is in, so a connection must only reach its own server. Guild-scoped endpoints take the guild from the installation, never from arguments. Before any call on `/channels/{id}/...`, the adapter resolves the channel's `guild_id` with `GET /channels/{id}` and rejects the call unless it matches. Direct message channels have no guild and are rejected. The answer is cached per process with no expiry, and a failed lookup is not cached.

## Data model

The package owns the `integrations_discord` database namespace and its `integrations_discord_installations` and `integrations_discord_gateway_sessions` tables. A guild and connection each have a unique installation row. Reinstalling the same guild for the same connection updates the installation and increments `generation`, which later lifecycle checks use for compare-and-set ordering. Deleting a connection removes the provider row so the guild can be seeded or installed again.

The sessions table holds one row per Gateway shard: `session_id`, `resume_gateway_url`, `received_sequence`, and `committed_sequence`. `committed_sequence` is the only resume point. `received_sequence` is diagnostics only, because the Gateway library advances it before a handler publishes. The repository reads the row when a leader starts, writes a new session at once, and flushes the session fields and both cursors in one write. A flush only applies while the stored session id matches, so a late flush from a replaced session does nothing. Within one session the committed cursor never goes down. Keep the library hooks in memory and flush on a timer, not on every dispatch.

## Development

Run these commands from the repository root:

```sh
mise exec -- turbo check type test depcruise --filter=@shipfox/api-integration-discord...
mise exec -- pnpm check:api-database-boundaries
mise exec -- pnpm check:api-migrations
```

The persistence tests use the repository PostgreSQL test service. Start it with `mise exec -- pnpm dev:services:up` when it is not already running.

## Gateway connection

The leader runs one shard (`shardCount: 1`) with the `GUILDS`, `GUILD_MESSAGES`, `GUILD_MESSAGE_REACTIONS`, and `MESSAGE_CONTENT` intents. It connects in the background, so the election keeps checking its lock while Discord is slow.

- **Resume.** A stored session is resumed from `committed_sequence`, with no age check. An Invalid Session falls back to Identify inside the library.
- **Hooks.** `retrieveSessionInfo` and `updateSessionInfo` are synchronous and in memory, because the library calls them on every frame and does not serialize frames. The row is written every 5 s and on shutdown. A new session id resets the committed mark and is written at once.
- **Committed mark.** Dispatches run in emit order, one at a time, through a handler registry. The mark is the highest sequence with every lower one handled, because the library can emit `READY` after `GUILD_CREATE`. A dispatch without a handler is skipped and committed.
- **Handler failure.** The manager is destroyed with close code `4000`, its queue is dropped, and a new manager resumes from the mark after backoff. Close code `1000` would end the session on Discord's side, and the store ignores the library's `null` session while the destroy is ours. A close the library will not recover from, such as a rejected token or disallowed intents, takes the same path and is reported.
- **Identify guard.** Every Identify waits on the manager's throttler: 5 s apart, refused below 100 remaining starts until `reset_after`, and `shards > 1` reported once. It waits and never throws, because a throw makes the library retry after 500 ms. Reports use the `integrations.discord.gateway` boundary.
- **Backoff.** Failed connects retry after 5 s, doubling up to 5 minutes, with jitter that only shortens the delay.

## Metrics and reports

Instance metrics live in `src/metrics/` and are scraped per pod. Only the leader reports the Gateway values.

| Metric | Type | Labels |
| --- | --- | --- |
| `integrations_discord_gateway_connected` | gauge | none. 1 on the leader while the socket is ready, otherwise 0. |
| `integrations_discord_gateway_identifies` | counter | `outcome`: `sent`, `refused_budget`. |
| `integrations_discord_gateway_resumes` | counter | `outcome`: `resumed`, `invalid_session`. |
| `integrations_discord_gateway_dispatches` | counter | `event`: `message_create`, `message_reaction_add`. `outcome`: `processed`, `duplicate`, `connection_unavailable`, `failed`. |
| `integrations_discord_identify_remaining` | gauge | none. From the last `/gateway/bot` answer. |
| `integrations_discord_guilds` | gauge | none. Guild count from the last `READY`, for the privileged-intent reach estimate. |
| `integrations_discord_gateway_cursor_lag` | gauge | none. Sequences received minus committed. |

The library has no Invalid Session event, so `invalid_session` counts a `null` session the library writes while a session is stored and the destroy is not ours. `sent` counts in the Identify guard. The dispatch queue records `failed` when a handler throws; handlers record the other outcomes.

Sentry reports use the `integrations.discord.gateway` boundary: Identify refused, `shards > 1`, a `401` on the bot token (once per failure streak), and no ready socket for 5 minutes while leading (once per stretch).

This build skips every dispatch, so it commits messages it cannot publish. Do not enable `DISCORD_GATEWAY_ENABLED` in staging or production until the message and reaction handlers are deployed.

## License

MIT
