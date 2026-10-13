# @shipfox/e2e-driver-slack

A fake Slack Web API and Events sender for E2E suites. The fake stands in for `slack.com/api` at the address the API reads from `SLACK_API_BASE_URL`. The event helpers post signed `app_mention` deliveries to the API's Slack webhook. Faking Slack is on purpose: it is the external system under integration.

## Public API

- `startSlackApiMock(options?)`: start the fake and return a `SlackApiMock`. It serves
  `conversations.replies`, `conversations.history`, `conversations.info`, `conversations.members`,
  `conversations.list`, `users.info`, `chat.getPermalink`, `chat.postMessage`, `chat.update`,
  `reactions.add`, `chat.scheduleMessage`, `chat.scheduledMessages.list`, `canvases.create`, and
  `canvases.sections.lookup`. `options.botToken` is the
  token of the connection the spec creates: the stack router sends the fake the requests that
  carry it, so specs in other workers share the address. The token is required unless
  `options.endpoint` is set, which listens directly instead. `options.botUserId` is the user of the
  bot's messages and reactions.
- `SlackApiMock.seedChannel`, `seedUser`, and `seedThread`: load the channels, users, and threads
  the read methods serve. Channel methods answer `channel_not_found` for a channel that is not
  seeded, and page by cursor like Slack does. `SlackChannelSeed` describes a channel.
- `SlackApiMock.calls`: every request the fake handled, as `SlackApiMockCall` entries.
- Writes change the fake's state, so reads return them: a posted message is in the channel history
  and its thread, an update replaces its text, a reaction is in its `reactions`, a scheduled message
  is in `chat.scheduledMessages.list` within its `post_at`, and a created canvas answers section
  lookups. Each posted message gets the next `ts`, starting at `SLACK_POSTED_TS`. A channel that
  is not seeded still accepts posts, but not updates or reactions.
- `SlackApiMock.writes()`: the writes the fake accepted, as `RecordedWrite` entries. A post targets
  its channel, an update or reaction its `channel/ts`, a scheduled message its channel, and a
  canvas its ID. A post made to fail with `setPostMessageError` is in `calls` but not in
  `writes()`.
- `signSlackHeaders`, `buildAppMentionEnvelope`, and `postSlackAppMention`: sign
  and send an `app_mention` event. `threadTs` makes it a mention inside a thread. The suite
  waits for the run it starts.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-slack...
```

## License

MIT
