---
"@shipfox/api-integration-discord": minor
"@shipfox/actions": patch
---

Adds the `read_thread` and `list_channels` Discord agent tools.

- **`read_thread`:** reads a thread oldest first. With a thread as `channel_id`, it returns the message the thread started from, then the thread. With a channel and the `message_id` of a message that started a thread, it returns that message then its thread. Otherwise it returns that single message. The same arguments serve a mention at the top level of a channel and inside a thread. `limit` (1 to 100, default 50) caps the thread messages.
- **`list_channels`:** lists the channels of the connected server, with `name_contains` to filter by name and `include_threads` to add the active threads. Each entry has `id`, `name`, `type`, `parent_id`, and `topic`.
- **Server boundary:** `read_thread` verifies the channel belongs to the connected server before any read, and `list_channels` takes the server from the connection, never from arguments.
- **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.read_thread` and `discord.list_channels`.
