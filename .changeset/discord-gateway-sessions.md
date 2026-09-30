---
"@shipfox/api-integration-discord": minor
---

Adds the `integrations_discord_gateway_sessions` table and its repository. The Gateway service uses it to keep the session id, resume URL, and two sequence cursors across leader changes. The committed cursor is the only resume point and never goes down within a session. The received cursor is for diagnostics.
