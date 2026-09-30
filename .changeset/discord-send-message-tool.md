---
"@shipfox/api-integration-discord": minor
"@shipfox/actions": patch
---

Adds the Discord `send_message` tool.

- **Tool:** `send_message` posts a Markdown message to a channel or thread in the connected server, with an optional `reply_to_message_id`. It returns the posted messages, the `id` of the first, and its `url`.
- **Threads:** `thread_message_id` posts in the thread of that message and creates a public thread named after the message's first 80 characters when there is none. It is ignored when `channel_id` is already a thread.
- **Long messages:** text over 2,000 characters is split on paragraph, line, then word boundaries into up to 5 messages. Text over 10,000 characters, or that needs more than 5 messages, fails with `content-too-large`.
- **Mentions:** every message is sent with `allowed_mentions: {parse: ["users"]}`, so it never pings roles or `@everyone`.
- **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.send_message`.
