---
"@shipfox/api-integration-discord": minor
"@shipfox/actions": patch
---

Adds the `search_messages` and `read_user_profile` Discord agent tools.

- **`search_messages`:** searches the connected server by `query`, with optional `channel_id` (checked against the server like `read_channel`), `author_id`, `limit` up to 25, and `offset`. Each match carries a `url`. While Discord indexes a new server it answers `202`, which the tool returns as `rate-limited` with `retryAfterSeconds`.
- **`read_user_profile`:** returns a member's nickname, username, global name, role IDs, and join date. The server always comes from the connection, never from arguments.
- **Client:** `createDiscordApiClient` gains `searchGuildMessages` and `getGuildMember`.
- **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.search_messages` and `discord.read_user_profile`.
