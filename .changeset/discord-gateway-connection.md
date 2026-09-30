---
"@shipfox/api-integration-discord": minor
"@shipfox/api-integration-core": patch
---

Connects the Discord Gateway leader to Discord with `@discordjs/ws`. The leader resumes from the committed cursor stored in its session row, or identifies when there is no session. It skips and commits every dispatch for now, so keep `DISCORD_GATEWAY_ENABLED` off in shared environments until message and reaction ingestion ship. Every Identify waits on a guard that spaces calls 5 seconds apart and refuses below 100 remaining starts. A handler failure destroys the manager with close code `4000` and resumes from the mark after a jittered backoff of 5 seconds up to 5 minutes.
