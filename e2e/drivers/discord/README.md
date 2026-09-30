# @shipfox/e2e-driver-discord

A signed Discord interaction sender for E2E suites. It stands in for Discord calling the API's
interactions endpoint, so a suite can run `/shipfox prompt:` without a real Discord server. Faking
Discord is on purpose: it is the external system under integration.

## Public API

- `postDiscordSlashCommand(params)`: post a signed `/shipfox prompt:` interaction to
  `/webhooks/integrations/discord/interactions` and return the interaction ID, which is the
  delivery ID the API records, with the HTTP status and the ephemeral acknowledgement Discord would
  show the user. `guildId` must belong to a connection made with `createDiscordConnection`.
- `signDiscordInteraction(rawBody, timestamp?)`: sign `timestamp + rawBody` with an Ed25519 key and
  return the body and the `x-signature-ed25519` and `x-signature-timestamp` headers. The timestamp
  defaults to now, so the API's 300 second freshness window accepts it.
- `buildSlashCommandInteraction(params)`: the interaction payload, for suites that post it another
  way.

Signing reads `E2E_DISCORD_PRIVATE_KEY`, a base64 PKCS#8 Ed25519 key. The E2E harness generates it
with the `DISCORD_PUBLIC_KEY` the API verifies against. To use your own key, set both.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-discord...
```

## License

MIT
