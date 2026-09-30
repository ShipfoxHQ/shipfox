# @shipfox/e2e-driver-jira

A fake Jira REST API for E2E suites. The fake stands in for `api.atlassian.com` at the address the API reads from `JIRA_API_BASE_URL`, and serves the `/ex/jira/<cloudId>/rest/api/3` routes the Jira agent tools call. Faking Jira is on purpose: it is the external system under integration.

## Public API

- `startJiraApiMock(endpoint?)`: start the fake and return a `JiraApiMock`. It serves the read
  routes (issue, comments, transitions, project, user, and JQL search) and the write routes
  (create and update issue, add comment, transition, and assign). Waits for the port when a spec
  in another worker holds it.
- `JiraApiMock.calls`: every request the fake handled, as `JiraApiMockCall` entries.
- `JiraApiMock.writes()`: the writes the fake accepted, as `RecordedWrite` entries targeted at
  the issue key, or at the project for a created issue.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-jira...
```

## License

MIT
