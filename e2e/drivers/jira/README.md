# @shipfox/e2e-driver-jira

A fake Jira REST API and signed webhook sender for E2E suites. The fake stands in for `api.atlassian.com` at the address the API reads from `JIRA_API_BASE_URL`, and serves the `/ex/jira/<cloudId>/rest/api/3` routes the Jira agent tools call. Faking Jira is on purpose: it is the external system under integration.

## Public API

- `startJiraApiMock(options?)`: start the fake and return a `JiraApiMock`. It serves the read
  routes (issue, comments, transitions, project, user, and JQL search) and the write routes
  (create and update issue, add comment, transition, and assign). `options.accessToken` is the
  token of the connection the spec creates: the stack router sends the fake the requests that
  carry it, so specs in other workers share the address. The token is required unless
  `options.endpoint` is set, which listens directly instead.
- `JiraApiMock.seed(seed)`: make the fake answer for given projects, issues, comments, and users with
  their ids and fields, as `JiraSeed` entries. An issue is served by its key or ID, its comments as
  ADF documents, and search returns the seeded issues. Anything not seeded keeps the generic
  answer, unless `options.rejectUnseeded` is set: an issue read then answers Jira's 404, and a
  search with unbalanced parentheses in its JQL answers 400.
- `JiraApiMock.calls`: every recognized request the fake handled, as `JiraApiMockCall` entries. Unknown paths and
  methods get a 404 or 405 and are not recorded.
- Writes change what the fake serves. A created issue gets the next key of its project and is read
  back by key or ID with its summary, description, labels, assignee, priority, and type. An update
  applies the summary, description, labels, assignee, priority, and type it sends, and ignores
  other fields. A comment shows in the issue's comments, an assignment in its
  `assignee`, and a transition moves its status: the default workflow offers the other two of
  `To Do` (11), `In Progress` (21), and `Done` (31), and a transition the issue cannot take answers
  400. The `update` operations of a write are recorded but not applied. A write to an issue the
  fake does not keep is accepted and changes nothing.
- `JiraApiMock.writes()`: the writes the fake accepted, as `RecordedWrite` entries targeted at
  the issue key, or at the project for a created issue.
- `postJiraIssueEvent(params)`: post a signed `jira:issue_created` or `jira:issue_updated` delivery
  to the API's Jira webhook route and return the delivery ID the API records for it, for correlating
  a run when a matching trigger starts one. Signing reads `JIRA_OAUTH_CLIENT_SECRET`, which the E2E
  harness sets. `connectionId` and `webhookId` must belong to a connection made with
  `createJiraConnection` and its `webhookIds`.
- `buildJiraIssueEnvelope`: the payload, in the shape of Jira's webhooks, for suites that post it
  another way. An issue can carry `projectKey`, `labels`, `description`, and `siteUrl` (for the
  `self` link), and an update can carry `previousLabels` next to `previousStatusName`, which the
  payload lists as changelog items.
- `JIRA_IN_PROGRESS_TRANSITION_ID`: the transition the fake offers into a status of the
  in-progress category. The fake's issue is in the `new` category, so workflows that move a ticket
  to in progress find it.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-jira...
```

## License

MIT
