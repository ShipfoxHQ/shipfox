---
'@shipfox/api-integration-slack': minor
'@shipfox/api-integration-core': patch
---

Slack agents acknowledge, show progress, and reply. A channel mention gets an `eyes` reaction and an agent view message sets the session to `processing` as soon as the event is accepted, before routing. A reply posts in the thread under the agent's name as a Markdown block, and an answer over Slack's 12,000-character block limit is split across messages. In the agent view, a working turn shows `processing` and an idle one sets `active`, so the loading status clears. Slack shows its own loading state, because `agents.sessions.setStatus` takes no tool label. A reply to an archived channel, or after the app was removed, is undeliverable, and a rate limit or Slack outage is retried. `createSlackIntegrationProvider` takes an `interaction` option with a token store, and without it replies are undeliverable.
