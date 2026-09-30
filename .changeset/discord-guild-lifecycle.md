---
"@shipfox/api-integration-discord": minor
"@shipfox/api-integration-core": patch
---

Tracks the bot's Discord guild membership from the Gateway: when the bot is removed from a guild, the Discord connection is marked `error`, and re-adding the bot restores it to `active`. The installation keeps the bot's managed role id across leader changes.
