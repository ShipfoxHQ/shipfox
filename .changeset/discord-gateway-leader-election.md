---
'@shipfox/api-integration-discord': minor
'@shipfox/api-integration-core': patch
'@shipfox/node-postgres': minor
---

Adds Discord Gateway leader election. When `DISCORD_GATEWAY_ENABLED` is set, each API replica runs `DiscordGatewayService`, and one replica holds the shard 0 Postgres advisory lock on a dedicated connection. The others retry every 10 seconds. The leader checks the connection every 15 seconds and reports `onLost` if it drops. `@shipfox/node-postgres` exports `openPostgresSession` for connections that live outside the pool.
