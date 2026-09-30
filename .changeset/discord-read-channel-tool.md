---
"@shipfox/api-integration-discord": minor
"@shipfox/api-integration-core": patch
"@shipfox/actions": patch
---

Adds the Discord agent tools adapter with the `read_channel` tool.

- **Tool:** `read_channel` reads messages from a channel or thread in the connected server, newest first, with `limit`, `before`, and `after`. Each message carries a `url`.
- **Server boundary:** the bot token reaches every server the bot is in, so a channel call first resolves the channel's server and fails unless it is the connection's server. Direct message channels are rejected. The answer is cached for the life of the process.
- **Errors:** a `403` names the channel and the permission the bot probably lacks. A `429` returns `retryAfterSeconds`. A `401` reports the broken bot token. A session fails with `credentials-unavailable` when the installation is missing or removed.
- **Catalog:** `@shipfox/api-integration-discord/agent-tools` exports the catalog, and connections created through the core module now advertise the `agent_tools` capability.
- **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.read_channel`.
