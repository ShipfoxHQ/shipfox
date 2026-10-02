---
"@shipfox/api-integration-discord": minor
"@shipfox/actions": patch
---

Adds the Discord `create_thread`, `update_message`, and `add_reaction` tools.

- **`create_thread`:** starts a public thread from a message or standalone, and returns its `id`, `channel_id`, and `url`. A message that already has a thread returns that thread. In a forum or media channel, `message` is required and becomes the post.
- **`update_message`:** replaces the text of a message the bot posted, up to 2,000 characters with no split. Editing another user's message fails with an `access-denied` error.
- **`add_reaction`:** reacts with a Unicode emoji, or `name:id` for a custom emoji. Shortcodes such as `:thumbsup:` are rejected.
- **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.create_thread`, `discord.update_message`, and `discord.add_reaction`.
