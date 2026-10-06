# @shipfox/e2e-driver-discord

Stand-ins for Discord in E2E suites: a signed interaction sender, a Gateway message injector, and a
fake REST API. Together they let a suite run `/shipfox prompt:` or mention the bot without a real
Discord server. Faking Discord is on purpose: it is the external system under integration.

## Public API

- `startDiscordApiMock(options?)`: serve the part of Discord's REST API the Discord tools use, on
  `DISCORD_API_BASE_URL`, backed by memory. Add what Discord would already hold with `addChannel`
  and `addMessage`, and the members of a server with `addMember`. The fake answers channels,
  messages, thread starts, a server's channels and active threads, its message search, and its
  members, and accepts bot messages. `writes()` lists the threads and messages it accepted, `messages(channelId)` reads a
  channel or thread back, and `calls` records every request with its `authorization` header. A
  thread started from a message takes that message's ID, as Discord does. One test at a time can
  hold the port, so keep the tests that use it in one serial file.
- `injectDiscordMessageCreate(params)`: deliver a `MESSAGE_CREATE` dispatch that mentions the bot
  unless `mentionsBot` is false, through `POST /__e2e/integrations/discord-dispatches`, which runs
  the handler the Gateway service uses. `connectionId` must belong to a connection made with `createDiscordConnection`. The message
  ID is the delivery ID the API records. `buildMessageCreate(params)` returns the payload alone.
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
