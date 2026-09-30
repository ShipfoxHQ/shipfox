# @shipfox/e2e-driver-clickup

A fake ClickUp API and event sender for E2E suites. The fake stands in for `api.clickup.com` at the address the API reads from `CLICKUP_API_BASE_URL`. The event helpers post signed `taskCommentPosted` deliveries. Faking ClickUp is on purpose: it is the external system under integration.

## Public API

- `startClickUpApiMock(endpoint?)`: start the fake and return a `ClickUpApiMock`. It serves
  task reads and task comments.
- `ClickUpApiMock.calls`: every request the fake handled, as `ClickUpApiMockCall` entries.
- `ClickUpApiMock.writes()`: the comments the fake accepted, as `RecordedWrite` entries
  targeted at their task ID.
- `signClickUpHeaders`, `buildTaskCommentPostedEnvelope`, and `postClickUpCommentDelivery`: sign
  and send a comment event. The suite waits for the run it starts.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-clickup...
```

## License

MIT
