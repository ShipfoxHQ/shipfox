---
"@shipfox/api-integration-discord": minor
"@shipfox/api-integration-core": patch
---

Publishes Discord messages as `message_create` events from the Gateway leader. Each event carries `mentions_bot` (the bot user in `mentions`, or the installation's managed role in `mention_roles`), an explicit `author.bot`, and `url`. The placement fields are conditional: `thread_id` is set for a message in a thread, and `root_channel_id` when the channel, or the thread's parent, is known. The message id is the delivery id, so resume replays, duplicate sessions, and overlapping leaders publish a message once. Direct messages and messages for a missing, removed, or inactive connection are dropped. A channel cache fed by `GUILD_CREATE` and the channel and thread dispatches resolves placement, with one `GET /channels/{id}` on a miss. Reaction dispatches are still skipped, so keep `DISCORD_GATEWAY_ENABLED` off in shared environments until reaction ingestion ships.
