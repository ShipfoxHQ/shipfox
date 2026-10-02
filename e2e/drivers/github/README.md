# @shipfox/e2e-driver-github

A fake GitHub API for E2E suites. It stands in for `api.github.com` at the address
the API reads from `GITHUB_API_BASE_URL`, so suites exercise the real GitHub
integration against deterministic responses. Faking GitHub is on purpose: it is the
external system under integration, exactly like Gitea for `@shipfox/e2e-driver-gitea`.

## Public API

- `startGithubApiMock(options?)`: start the fake and return a `GithubApiMock`. It
  serves installation tokens, repository and issue reads, pull request create,
  list, read, update, and merge, review comment replies, issue comments, issue
  search, GraphQL review threads and `createCommitOnBranch`, issue creation, check
  runs, and an empty workflow run history. The stack router sends the fake the token mints for
  its `installationId` and the requests that carry its `installationToken`, so specs in other
  workers share the address; make both unique to the spec. `installationId` is required
  unless `options.endpoint` is set, which listens directly instead. Git transport needs `git` on the `PATH`.
- `GithubApiMock.calls`: every request the fake handled, as `GithubApiMockCall`
  entries in arrival order.
- `GithubApiMock.pullRequests`, `reviewThreads`, and `branchHeads`: state a test
  seeds once it knows the commits. Pull requests created through the API land in
  `pullRequests`, and replies and thread resolution update `reviewThreads`. A pull
  request's `author` is the login its `user` reports, and defaults to `e2e-author`.
- `GithubApiMock.issues`: issues by number, with title, body, state, labels, assignees,
  and comments. `GET /repos/:owner/:repo/issues/:number` and its `/comments` and
  `/labels` routes read them. An issue read for a number not listed answers a synthetic
  issue with `GITHUB_READ_RESULT_MARKER`. Issues and pull requests share the numbering,
  so a created pull request skips the numbers issues use.
- `GithubApiMock.addRepository(params)`: creates a bare repository, seeded from a
  directory, and serves it over git smart HTTP at
  `<endpoint>/github.com/<owner>/<repo>.git`. The repository API returns that URL as
  `clone_url`, so `git remote get-url origin` keeps the `github.com/<owner>/<repo>`
  identity that templates parse. Git requests need the token the fake mints, as
  basic auth with the password set to the token.
- `GithubApiMock.addBranch(params)`: commits a directory as the whole tree of a new
  branch, on top of the default branch, and returns its tip. The branch tip also
  lands in `branchHeads`. A seeded pull request on it reports that tip as its head.
  Adding a branch records no write.
- `GithubApiMock.writes()`: the accepted state-changing requests as `RecordedWrite`
  entries (`kind`, `target`, `payload`) in arrival order. A request that GitHub
  would reject is not recorded. `target` is `owner/repo#<number>` for pull
  request writes. It records these kinds:
  `github.create_pull_request`, `github.update_pull_request`,
  `github.merge_pull_request`, `github.reply_to_review_comment`,
  `github.create_issue_comment`, and `github.resolve_review_thread`. Issue writes are
  `github.update_issue` (`PATCH /issues/:number`, where `labels` replaces the whole set),
  `github.add_labels` (`POST /issues/:number/labels`), and `github.remove_label`
  (`DELETE /issues/:number/labels/:name`, `payload.name` is the label); each targets
  `owner/repo#<number>`. Comments on a number no issue is seeded for, such as a pull
  request, are recorded without being stored. Each branch update from a git push is a `github.push`
  write with `repository`, `branch`, `before`, and `after`; a missing side is `null`.
  `RecordedWrite` itself lives in `@shipfox/e2e-core`.
- `GithubApiMock.sendPullRequestReviewComment(params)`: records a review comment as a new
  thread on a pull request in `pullRequests`, and delivers a signed
  `pull_request_review_comment.created` webhook for it to the API. It returns the
  `deliveryId`, `commentId`, and `threadId`, so the fake's reply and thread routes accept them.
- `GithubApiMock.sendPullRequestClosed(params)`: closes a pull request in `pullRequests`, as
  merged when `merged` is true, and delivers a signed `pull_request.closed` webhook. Both
  payloads come from the fake's pull request state and carry the repository, sender, and
  `installation.id` that GitHub sends, so the API routes them to the connection that shares the
  fake's `installationId`. Set `webhookSecret` on the fake, or export
  `GITHUB_APP_WEBHOOK_SECRET`, to sign with the API's secret; the harness sets the latter. Set
  `apiUrl` to deliver somewhere other than the E2E API.
- `GithubApiMock.sendWorkflowRunCompleted(params)`: delivers a signed `workflow_run.completed`
  webhook for a repository, with the run's `conclusion` (default `failure`) and `headBranch`
  (default: the first pull request's head, else the repository's default branch). It also sets the workflow path and name, run and
  attempt numbers, triggering `event`, `actor`, head commit message, head repository (set it to
  model a fork), and `pullNumbers`, which must exist in `pullRequests`. Each call gets its own
  run ID unless `runId` is set.
- `GithubApiMock.sendIssueLabeled(params)` and `sendIssueAssigned(params)`: add the label or
  assignee to the issue in `issues`, unless it holds it, and deliver a signed `issues.labeled`
  or `issues.assigned` webhook with the issue's new state, the `label` or `assignee`, and the
  same repository, sender, and `installation.id` envelope. The sender defaults to
  `e2e-maintainer`.
- `signGithubWebhook(params)`: the `X-Hub-Signature-256`, `X-GitHub-Event`, and
  `X-GitHub-Delivery` headers for a raw body.
- `GITHUB_*_INSTALLATION_TOKEN` and `GITHUB_*_RESULT_MARKER`: constants the suites
  assert on.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-github...
```

## License

MIT
