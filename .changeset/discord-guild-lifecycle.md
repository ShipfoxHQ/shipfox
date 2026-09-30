---
"@shipfox/api-integration-discord": minor
"@shipfox/api-integration-core": patch
---

Tracks Discord guild removal and the bot's managed role from the Gateway. `READY`, `GUILD_DELETE`, and `GUILD_CREATE` on a removed installation run a removal check that confirms over REST and updates the installation and the connection in one transaction, only if no reinstall bumped the installation generation in between. `GUILD_CREATE` and bot role dispatches write `bot_role_id`.
