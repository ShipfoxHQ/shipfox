# @shipfox/e2e-driver-clickup

A fake ClickUp API and event sender for E2E suites. The fake stands in for `api.clickup.com` at the address the API reads from `CLICKUP_API_BASE_URL`. The event helpers post signed `taskCommentPosted`, `taskTagUpdated`, and `taskStatusUpdated` deliveries. Faking ClickUp is on purpose: it is the external system under integration.

## Public API

- `startClickUpApiMock(options?)`: start the fake and return a `ClickUpApiMock`. It
  serves task reads, task updates, and task comments. `options.accessToken` is the token of the
  connection the spec creates: the stack router sends the fake the requests that carry it, so
  specs in other workers share the address. The token is required unless `options.endpoint`
  is set, which listens directly instead.
  `options.tasks` lists the tasks it serves
  by ID, with their name, URL, and Markdown description. Any other task gets a placeholder.
- `ClickUpApiMock.calls`: every request the fake handled, as `ClickUpApiMockCall` entries.
- `ClickUpApiMock.writes()`: the comments (`add_comment`) and task updates (`update_task`) the
  fake accepted, as `RecordedWrite` entries targeted at their task ID.
- `signClickUpHeaders`, `buildTaskCommentPostedEnvelope`, and `postClickUpCommentDelivery`: sign
  and send a comment event. The suite waits for the run it starts.
- `buildTaskTagUpdatedEnvelope` and `buildTaskStatusUpdatedEnvelope`: the payloads of a tag
  change and a status change, in the shape of ClickUp's webhooks. Each carries the List ID as the
  change record's `parent_id`, which the triggers filter on.
- `postClickUpDelivery`: sign and send any envelope, and return the delivery ID the API records.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-clickup...
```

## License

MIT
