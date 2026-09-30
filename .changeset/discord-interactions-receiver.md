---
"@shipfox/api-integration-discord": minor
"@shipfox/api-integration-core": patch
---

Receives Discord interactions at `POST /webhooks/integrations/discord/interactions`. Requests are verified with Ed25519 and rejected when their timestamp is more than 300 seconds from receipt. The `/shipfox` and `Send to Shipfox` commands publish `slash_command` and `message_command` events, and Discord gets an ephemeral acknowledgement.
