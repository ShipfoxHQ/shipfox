# @shipfox/api-integration-discord

## 34.0.0

### Minor Changes

- 73f496d: Register the `/shipfox` and "Send to Shipfox" Discord commands at startup, overwriting them only when they differ.
- cdc958f: Connects the Discord Gateway leader to Discord with `@discordjs/ws`. The leader resumes from the committed cursor stored in its session row, or identifies when there is no session. It skips and commits every dispatch for now, so keep `DISCORD_GATEWAY_ENABLED` off in shared environments until message and reaction ingestion ship. Every Identify waits on a guard that spaces calls 5 seconds apart and refuses below 100 remaining starts. A handler failure destroys the manager with close code `4000` and resumes from the mark after a jittered backoff of 5 seconds up to 5 minutes.
- 2d009f4: Adds Discord Gateway leader election. When `DISCORD_GATEWAY_ENABLED` is set, each API replica runs `DiscordGatewayService`, and one replica holds the shard 0 Postgres advisory lock on a dedicated connection. The others retry every 10 seconds. The leader checks the connection every 15 seconds and reports `onLost` if it drops. `@shipfox/node-postgres` exports `openPostgresSession` for connections that live outside the pool.
- 7cd8aea: Instruments the Discord Gateway with instance metrics for connection state, Identify and resume outcomes, dispatch outcomes, Identify budget, guild count, and cursor lag. Reports a rejected bot token and a leader with no ready socket for 5 minutes to Sentry.
- ddada51: Adds repository support for storing Discord Gateway sessions across leader changes.
- 7c77f5d: Tracks the bot's Discord guild membership from the Gateway: when the bot is removed from a guild, the Discord connection is marked `error`, and re-adding the bot restores it to `active`. The installation keeps the bot's managed role id across leader changes.
- 728e369: Deleting a Discord connection now makes the bot leave the server once the connection records are deleted.
- 5ffbd17: Receives Discord interactions at `POST /webhooks/integrations/discord/interactions`. Requests are verified with Ed25519 and rejected when their timestamp is more than 300 seconds from receipt. The `/shipfox` and `Send to Shipfox` commands publish `slash_command` and `message_command` events, and Discord gets an ephemeral acknowledgement.
- 491fce5: Publishes Discord messages as `message_create` events from the Gateway leader. Each event carries `mentions_bot` (the bot user in `mentions`, or the installation's managed role in `mention_roles`), an explicit `author.bot`, and `url`. The placement fields are conditional: `thread_id` is set for a message in a thread, and `root_channel_id` when the channel, or the thread's parent, is known. The message id is the delivery id, so resume replays, duplicate sessions, and overlapping leaders publish a message once. Direct messages and messages for a missing, removed, or inactive connection are dropped. A channel cache fed by `GUILD_CREATE` and the channel and thread dispatches resolves placement, with one `GET /channels/{id}` on a miss. Reaction dispatches are still skipped, so keep `DISCORD_GATEWAY_ENABLED` off in shared environments until reaction ingestion ships.
- b3796d7: Adds the Discord OAuth connect flow: an install route that returns the authorize URL, and a callback route that exchanges the code, checks the bot is in the server under the per-guild lock, and connects or reconnects it. The install state is bound to the browser that started it. Adds the OAuth code exchange and token revoke to the Discord REST client.
- 21f52ab: Publishes Discord reactions as `message_reaction_add` events from the Gateway leader. Each event carries an explicit `member.user.bot`; `root_channel_id` is included when the reacted channel (or its thread parent) is known, and `url` always points at the reacted message. The delivery id is `<session_id>:<sequence>`, so resume replays of one session publish a reaction once, and a reaction removed and added again is not dropped. Reactions in a guild without an installed, active connection are dropped.
- 1153277: Adds the Discord agent tools adapter with the `read_channel` tool.

  - **Tool:** `read_channel` reads messages from a channel or thread in the connected server, newest first, with `limit`, `before`, and `after`. Each message carries a `url`.
  - **Server boundary:** the bot token reaches every server the bot is in, so a channel call first resolves the channel's server and fails unless it is the connection's server. Direct message channels are rejected. The answer is cached for the life of the process.
  - **Errors:** a `403` names the channel and the permission the bot probably lacks. A `429` returns `retryAfterSeconds`. A `401` reports the broken bot token. A session fails with `credentials-unavailable` when the installation is missing or removed.
  - **Catalog:** `@shipfox/api-integration-discord/agent-tools` exports the catalog, and connections created through the core module now advertise the `agent_tools` capability.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.read_channel`.

- e6986cb: Adds the `read_thread` and `list_channels` Discord agent tools.

  - **`read_thread`:** reads a thread oldest first. With a thread as `channel_id`, it returns the message the thread started from, then the thread. With a channel and the `message_id` of a message that started a thread, it returns that message then its thread. Otherwise it returns that single message. The same arguments serve a mention at the top level of a channel and inside a thread. `limit` (1 to 100, default 50) caps the thread messages.
  - **`list_channels`:** lists the channels of the connected server, with `name_contains` to filter by name and `include_threads` to add the active threads. Each entry has `id`, `name`, `type`, `parent_id`, and `topic`.
  - **Server boundary:** `read_thread` verifies the channel belongs to the connected server before any read, and `list_channels` takes the server from the connection, never from arguments.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.read_thread` and `discord.list_channels`.

- 979b1a5: Adds the Discord REST client with typed guild, channel, Gateway, and application command calls. Failures map to `DiscordIntegrationProviderError`, and requests are never retried.
- 7d2b854: Adds the `search_messages` and `read_user_profile` Discord agent tools.

  - **`search_messages`:** searches the connected server by `query`, with optional `channel_id` (checked against the server like `read_channel`), `author_id`, `limit` up to 25, and `offset`. Each match carries a `url`. While Discord indexes a new server it answers `202`, which the tool returns as `rate-limited` with `retryAfterSeconds`.
  - **`read_user_profile`:** returns a member's nickname, username, global name, role IDs, and join date. The server always comes from the connection, never from arguments.
  - **Client:** `createDiscordApiClient` gains `searchGuildMessages` and `getGuildMember`.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.search_messages` and `discord.read_user_profile`.

- 62f96d4: Adds the Discord `send_message` tool.

  - **Tool:** `send_message` posts a Markdown message to a channel or thread in the connected server, with an optional `reply_to_message_id`. It returns the posted messages, the `id` of the first, and its `url`.
  - **Threads:** `thread_message_id` posts in the thread of that message and creates a public thread named after the message's first 80 characters when there is none. It is ignored when `channel_id` is already a thread.
  - **Long messages:** text over 2,000 characters is split on paragraph, line, then word boundaries into up to 5 messages. Text over 10,000 characters, or that needs more than 5 messages, fails with `content-too-large`.
  - **Mentions:** every message is sent with `allowed_mentions: {parse: ["users"]}`, so it never pings roles or `@everyone`.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.send_message`.

- bc9f9c7: Adds the Discord `create_thread`, `update_message`, and `add_reaction` tools.

  - **`create_thread`:** starts a public thread from a message or standalone, and returns its `id`, `channel_id`, and `url`. A message that already has a thread returns that thread. In a forum or media channel, `message` is required and becomes the post.
  - **`update_message`:** replaces the text of a message the bot posted, up to 2,000 characters with no split. Editing another user's message fails with an `access-denied` error.
  - **`add_reaction`:** reacts with a Unicode emoji, or `name:id` for a custom emoji. Shortcodes such as `:thumbsup:` are rejected.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.create_thread`, `discord.update_message`, and `discord.add_reaction`.

### Patch Changes

- 280260c: The E2E routes can inject a Discord Gateway dispatch through the handlers the Gateway service uses.
- Updated dependencies [16d18f4]
- Updated dependencies [c4f486b]
- Updated dependencies [a02f5cf]
- Updated dependencies [eec818d]
- Updated dependencies [2d009f4]
- Updated dependencies [c06262b]
- Updated dependencies [24ea599]
- Updated dependencies [c8e0869]
- Updated dependencies [21c993b]
- Updated dependencies [1d94e37]
- Updated dependencies [c06262b]
- Updated dependencies [e2e561c]
- Updated dependencies [7d9b08a]
- Updated dependencies [82f2480]
- Updated dependencies [89a6cc7]
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/api-integration-spi@4.4.0
  - @shipfox/api-integration-discord-dto@34.0.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/node-module@1.2.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/api-workspaces-dto@34.0.0
  - @shipfox/node-drizzle@0.3.7
