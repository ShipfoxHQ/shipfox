# @shipfox/e2e-driver-clickup

A fake ClickUp API and event sender for E2E suites. The fake stands in for `api.clickup.com` at the address the API reads from `CLICKUP_API_BASE_URL`. The event helpers post signed `taskCommentPosted`, `taskTagUpdated`, and `taskStatusUpdated` deliveries. Faking ClickUp is on purpose: it is the external system under integration.

## Public API

- `startClickUpApiMock(options?)`: start the fake and return a `ClickUpApiMock`. It
  serves task reads, task searches, task creation, task updates, task comments, tag changes, and
  custom field values, and a read shows each change. `options.accessToken` is the token of the
  connection the spec creates: the stack router sends the fake the requests that carry it, so
  specs in other workers share the address. The token is required unless `options.endpoint`
  is set, which listens directly instead.
  `options.tasks` lists the tasks it serves
  by ID, with their name, URL, and Markdown description. A task can also name its List, be closed
  or a subtask, and hold comments, tags, and custom field values. Any other task gets a placeholder, unless
  `options.rejectUnseeded` is set: a read then answers 401, as ClickUp does for a task it cannot
  find. A task search for a negative or fractional `page` answers 500.
- `ClickUpApiMock.tasks`: the tasks the fake serves, by ID. Add to it to seed the fake after it
  started. A task search answers 100 tasks a page for the Lists it names, and leaves out closed
  tasks and subtasks unless the search asks for them. A comment list answers the first 25 comments.
- `ClickUpApiMock.calls`: every request the fake handled, as `ClickUpApiMockCall` entries.
- `ClickUpApiMock.writes()`: the tasks created (`create_task`, targeted at their List ID), the task
  updates (`update_task`), the comments (`add_comment`), the tag changes (`add_tag`,
  `remove_tag`), and the custom field values (`set_custom_field`) the fake accepted, as
  `RecordedWrite` entries. All but task creation are targeted at their task ID. Tag names are
  stored in lowercase, as ClickUp does. A task update changes the name, the Markdown description,
  and the status. The `complete` and `closed` statuses close the task. A comment goes first in the
  comment list. A task the fake does not hold still gets a placeholder answer to an update or a
  comment.
- `signClickUpHeaders`, `buildTaskCommentPostedEnvelope`, and `postClickUpCommentDelivery`: sign
  and send a comment event. The suite waits for the run it starts.
- `buildTaskTagUpdatedEnvelope` and `buildTaskStatusUpdatedEnvelope`: the payloads of added tags
  and a status change, in the shape of ClickUp's webhooks. The tag change has no `before`, as
  ClickUp sends it. Each carries the List ID as the change record's `parent_id`, which the
  triggers filter on.
- `postClickUpDelivery`: sign and send any envelope, and return the delivery ID the API records.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-clickup...
```

## License

MIT
