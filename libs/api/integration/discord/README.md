# Discord integration

`@shipfox/api-integration-discord` provides the config-gated Discord provider scaffold, guild installation persistence, and E2E connection seed route used by later Discord features.

## What it does

- **`createDiscordIntegrationProvider`** exposes the Discord provider metadata, guild external URL, and the connection cleanup hooks. Deletion runs under the per-guild advisory lock `integrations:discord:guild:<guild_id>` (`withDiscordGuildLock`, 30 s bounded wait), and once the records commit the bot leaves the guild. A `403` or `404` from Discord counts as done, and any other failure is logged.
- **Installation repository exports** create, find, and delete Discord guild installations owned by the provider database.
- **`createDiscordInstallRoutes`** serves the OAuth connect flow. The core adapter passes it through the provider's `install` option.
- **`createDiscordWebhookRoutes` and `createDiscordWebhookProcessor`** receive Discord interactions, verify them, and publish command events.
- **`createDiscordE2eRoutes`** exposes the synthetic connection route used by integration and E2E tests.
- **`createDiscordGatewayService`** returns the `ModuleService` that elects one Gateway leader per shard with a Postgres advisory lock. Each replica holds a dedicated connection, retries every 10 s, and checks it with `SELECT 1` every 15 s. The `onLeading` and `onLost` callbacks carry the leader's work; `onLost` runs before the lock is released on shutdown.
- **`createDiscordApiClient`** calls the Discord REST API as the bot and maps failures to `DiscordIntegrationProviderError`.
- **`createDiscordGateway`** returns the Gateway `ModuleService`: the leader election with the shard connection as the leader's work. It connects with `@discordjs/ws`, resumes from the stored committed cursor, and identifies through an Identify guard.
- **`DiscordAgentToolsProvider`** serves the agent tools as the bot. The provider registers it as the `agent_tools` adapter, and `@shipfox/api-integration-discord/agent-tools` exports the catalog for the docs and action-type generators. It offers `read_channel`, `read_thread`, `search_messages`, `list_channels`, `read_user_profile`, `send_message`, `create_thread`, `update_message`, and `add_reaction`.
- **`registerDiscordCommands`** compares the application's registered commands with the `/shipfox` and "Send to Shipfox" definitions from `discord-dto` and overwrites them only on a difference. The integrations module runs it as a startup task on every replica.
- **`createDiscordGatewayHandlers`** returns the dispatch handlers: the channel cache, the `MESSAGE_CREATE` publisher, and the guild lifecycle handlers. Pass them to `createDiscordGateway({handlers})`.
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

`POST /integrations/discord/install` takes `{workspace_id}` and returns the Discord authorize URL: `scope=bot applications.commands` (no `identify`), the bot permissions integer `309237730368`, `integration_type=0`, `response_type=code`, and a signed `state`. The state carries the workspace id, user id, nonce, and a 30-minute expiry, signed with `DISCORD_OAUTH_CLIENT_SECRET`. The same nonce is set in the `shipfox_discord_install_state` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, scoped to `/integrations/discord`), so only the browser that started the install can finish it.

`GET /integrations/discord/callback/api` completes the install for the signed-in user:

1. The state must verify, match the cookie nonce, and belong to the session user, or the request fails before any Discord call. The cookie is cleared on every callback, so a callback cannot be replayed.
2. The code exchange returns the guild. The `guild_id` on the callback query is never used. The user token is revoked right after, and a failed revoke is only logged.
3. The route takes the guild lock and holds it through step 6, so a concurrent disconnect either finishes first or waits for the new records.
4. `GET /guilds/{id}` with the bot token confirms the bot is in the guild and gives the managed role (`tags.bot_id` equal to `DISCORD_APPLICATION_ID`) with its `permissions`.
5. A guild held by another workspace fails with `409`.
6. The core adapter upserts the connection (`active`) and the installation (`installed`, `permissions`, `bot_role_id`, bumped `generation`) in one transaction.

| Outcome | Response |
| --- | --- |
| `connected`, `reconnected` | `200` with `{outcome, connection}`. `reconnected` means the workspace already held the guild. |
| `access_denied` | `200` with `{outcome}`. The person cancelled on Discord. |
| `state-invalid` | `400` `invalid-discord-install-state`, or `403` `discord-install-state-actor-mismatch`. |
| `already-linked` | `409` `discord-installation-already-linked`. |
| `bot-not-in-guild` | `422` `discord-bot-not-in-guild`. The exchange had no guild, or the membership check answered `403` or `404`. |
| `provider-unavailable` | `503`, or `429` when Discord rate limits. Other OAuth errors are `422` `discord-oauth-callback-error`. |

`createDiscordE2eRoutes` registers `POST /integrations/discord-connections` under the E2E route prefix. It accepts the Discord DTO seed body and returns the integration connection DTO. This route is for test setup, not production clients.

## REST client

`createDiscordApiClient()` reads `DISCORD_BOT_TOKEN`, `DISCORD_API_BASE_URL`, `DISCORD_APPLICATION_ID`, `DISCORD_OAUTH_CLIENT_SECRET`, and `DISCORD_OAUTH_REDIRECT_URL` from `config`. Pass options to override them. It exposes `exchangeAuthorizationCode` and `revokeAccessToken` for the install flow, which authenticate with the OAuth client credentials instead of the bot token, and `getGuild`, `getChannel`, `getMessage`, `listChannelMessages`, `listGuildChannels`, `listActiveGuildThreads`, `searchGuildMessages`, `getGuildMember`, `leaveGuild`, `getGatewayBot`, `listApplicationCommands`, and `overwriteApplicationCommands`.

Requests time out after 10 seconds and are never retried, because Discord counts `401`, `403`, and `429` answers toward an IP-wide block. Failures throw `DiscordIntegrationProviderError`:

| Discord answer | `reason` |
| --- | --- |
| `401` | `credentials-unavailable` |
| `403` | `access-denied`, with `discordCode` such as `50001` or `50013` |
| `404` | `not-found` |
| `429` | `rate-limited`, with `retryAfterSeconds` from `retry_after` |
| `202` on message search | `rate-limited`, with `retryAfterSeconds` from `retry_after`, while Discord indexes a new server |
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
| Discord `429`, or `202` while Discord indexes the server for `search_messages` | `rate-limited`, with `retryAfterSeconds` |
| Timeout, `5xx` | `provider-unavailable` |

The bot token reaches every server the bot is in, so a connection must only reach its own server. Guild-scoped endpoints take the guild from the installation, never from arguments. Before any call on `/channels/{id}/...`, the adapter resolves the channel's `guild_id` with `GET /channels/{id}` and rejects the call unless it matches. Direct message channels have no guild and are rejected. The answer is cached per process with no expiry, and a failed lookup is not cached. `list_channels` is guild-scoped and takes the guild from the installation.

`send_message` posts as the bot with `allowed_mentions: {parse: ["users"]}`, so it never pings roles or `@everyone`. Messages over 2,000 characters are split on paragraph, then line, then word boundaries into up to 5 messages, and longer text fails with `content-too-large`. With `thread_message_id`, it posts in the thread of that message and starts a public thread named after the message's first 80 characters when there is none. It ignores `thread_message_id` when `channel_id` is already a thread, and it sends `reply_to_message_id` only on the first message and only when it does not redirect to a thread. `ensureMessageThread` in `src/core/message-thread.ts` is the thread helper.

`create_thread` starts a public thread, from `message_id` or standalone, and returns the thread's `id`, parent `channel_id`, and `url`. A message that already has a thread returns that thread instead of failing. In a forum or media channel, `message` is required and becomes the post, and `message_id` is rejected; elsewhere `message` is rejected, and `send_message` posts in the new thread. A thread cannot hold a thread. `ensureMessageThread` takes the thread name, which defaults to the message's first 80 characters.

`update_message` replaces the text of a message the bot posted, up to 2,000 characters with no split, and fails with `content-too-large` above that. Discord answers an edit of another user's message with `50005`, which maps to an `access-denied` error that names no permission. `add_reaction` takes the Unicode emoji or `name:id` for a custom emoji, and rejects shortcodes such as `:thumbsup:` before calling Discord. All three verify the channel first, and `update_message` and `create_thread` send `allowed_mentions: {parse: ["users"]}`.

`read_thread` reads a thread oldest first. In a thread, it returns the message the thread started from (read from the parent channel, absent for a thread that has none), then the most recent `limit` messages. In a channel, it needs `message_id`: it returns that message, followed by its thread when it started one. A `403` on `list_channels` names the server instead of a channel.

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

## Message and reaction ingestion

`createDiscordGatewayHandlers` publishes `MESSAGE_CREATE` as `message_create`:

1. A message without `guild_id` is dropped. So is a message whose guild has no `installed` installation, or whose connection is not `active` (`connection_unavailable`).
2. The Shipfox fields are added to Discord's message object. `mentions_bot` is true when the bot user is in `mentions` or the installation's `bot_role_id` is in `mention_roles`. A reply with the ping off lists nobody, so it is not a mention. `author.bot` is always a boolean.
3. `thread_id` and `root_channel_id` come from the channel cache: the channel itself for a top-level message, the parent for a thread message or forum post. The cache is fed by `GUILD_CREATE`, `THREAD_LIST_SYNC`, and the channel and thread create and update dispatches, and dropped on `CHANNEL_DELETE` and `THREAD_DELETE`. Entries never expire. A miss makes one `GET /channels/{id}`, and if it fails the event publishes without `thread_id` and `root_channel_id`. A resume sends no `GUILD_CREATE`, so the cache starts empty after a takeover.
4. The event publishes in one transaction with the message id as the delivery id. A duplicate from a resume replay or a second session publishes nothing. A publish failure throws, so the committed mark stays below the message.

`MESSAGE_REACTION_ADD` publishes as `message_reaction_add` through the same guild, connection, and channel-cache checks. `member.user.bot` is always a boolean, and `root_channel_id` and `url` describe the reacted message. A reaction has no id of its own, so the delivery id is `<session_id>:<sequence>`. It is the same across resume replays of one session. Two overlapping leaders run different sessions, so a rare duplicate gets through. A `(message, user, emoji)` key would drop a reaction removed and added again within the retention window.

Dispatches without a handler are skipped and committed.

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

The library has no Invalid Session event, so `invalid_session` counts a `null` session the library writes while a session is stored and the destroy is not ours. `sent` counts in the Identify guard. The dispatch queue records `failed` when a handler throws; the message handler records `processed`, `duplicate`, and `connection_unavailable`, and nothing for a DM or a malformed message.

Sentry reports use the `integrations.discord.gateway` boundary: Identify refused, `shards > 1`, a `401` on the bot token (once per failure streak), and no ready socket for 5 minutes while leading (once per stretch).

## Guild lifecycle

`createDiscordGatewayHandlers` handles these guild dispatches, on top of the channel cache and messages.

| Dispatch | Handling |
| --- | --- |
| `READY` | An installed guild absent from `READY.guilds` goes through the removal check. |
| `GUILD_CREATE` | Writes the bot's managed role id when it differs. A `removed` installation goes through the removal check again. |
| `GUILD_DELETE` | Runs the removal check, unless the guild is only `unavailable`. |
| `GUILD_ROLE_CREATE`, `GUILD_ROLE_UPDATE` | Writes the role id when `tags.bot_id` is the application id. |

The role id lives on the installation row, so a leader that resumes without a `GUILD_CREATE` still knows it. The removal check reads the installation's `generation`, calls `GET /guilds/{id}`, and then updates that installation row `WHERE generation = g` in the same transaction as the connection lifecycle. `200` means installed and `active`. `403` and `404` mean removed and `error`. A reinstall in between bumps the generation, and a delete followed by a reinstall replaces the row, so the update matches nothing and the newer state stays. Any other answer changes nothing, and the next `READY` retries.

## License

MIT
