# @shipfox/e2e-driver-github

A fake GitHub API for E2E suites. It stands in for `api.github.com` at the address
the API reads from `GITHUB_API_BASE_URL`, so suites exercise the real GitHub
integration against deterministic responses. Faking GitHub is on purpose: it is the
external system under integration, exactly like Gitea for `@shipfox/e2e-driver-gitea`.

## Public API

- `startGithubApiMock(options?)`: start the fake and return a `GithubApiMock`. It
  serves installation tokens, repository and issue reads, pull request create,
  list, read, update, and merge, review comment replies, issue comments, issue
  list and search, issue types, GraphQL review threads, Git database commits, issue
  creation, check runs, the workflow, run, job, and artifact reads, and the branch, commit,
  status, check run, and comparison reads. Writes change the state the reads serve: a
  created issue, branch, commit, check run, review, or workflow run reads back. The stack router sends the fake the token mints for
  its `installationId` and the requests that carry its `installationToken`, so specs in other
  workers share the address; make both unique to the spec. Behind the router, `installationId` is
  required. `options.endpoint` listens directly instead, but the webhook senders below still need
  `installationId`. Git transport needs `git` on the `PATH`.
- `GithubApiMock.calls`: every request the fake handled, as `GithubApiMockCall`
  entries in arrival order.
- `GithubApiMock.pullRequests`, `reviewThreads`, and `branchHeads`: state a test
  seeds once it knows the commits. Pull requests created through the API land in
  `pullRequests`, and replies and thread resolution update `reviewThreads`. A pull
  request's `author` is the login its `user` reports, and defaults to `e2e-author`.
- `GithubApiMock.issues`: issues by number, with title, body, state, labels, assignees,
  and comments. `GET /repos/:owner/:repo/issues/:number` and its `/comments` and
  `/labels` routes read them. An issue read for a number not listed answers a synthetic
  issue with `GITHUB_READ_RESULT_MARKER`. `GithubApiMock.access` changes that for whole
  repositories: a request under `/repos/:owner/:repo` answers 404 for a repository in
  `access.denied` (`owner/name`), and, with `access.rejectUnseeded`, for a repository that
  `addRepository` did not register. Issues and pull requests share the numbering,
  so a created pull request skips the numbers issues use, and so does a created issue, which
  `POST /repos/:owner/:repo/issues` adds to `issues` and answers with `GITHUB_WRITE_RESULT_MARKER`
  next to its fields. A new comment takes an id past the ids of every seeded comment. `GET /repos/:owner/:repo/issues`
  lists them, with the pull requests of `pullRequests` as GitHub does, filtered by `state` and
  `labels` and paged by `per_page` and `page`. `GET /search/issues` matches the issues and pull
  requests of the `repo:` repository on `is:issue`, `is:pr`, `is:open`, `is:closed`, and the
  words of its title or body, and answers an empty result when nothing matches. `GET /repos/:owner/:repo/issue-types` lists the types an
  organization starts with: Task, Bug, and Feature. An issue's `parent` is the number of the
  issue it is a sub-issue of: `GET /issues/:number/sub_issues` lists the children of an issue, and
  `GET /issues/:number/parent` answers the parent or 404. A sub-issue is named by the `id` of its
  issue (1000000 plus the number): `POST /issues/:number/sub_issues` adds it last,
  `DELETE /issues/:number/sub_issue` removes it, and `PATCH /issues/:number/sub_issues/priority`
  moves it before or after a sibling. A closed issue reads `state_reason`, `completed` unless the
  update said otherwise. The comments route pages by `per_page`
  and `page`, and lists the `comments` of a seeded pull request for its number too. A comment
  posted on a pull request joins its `comments`. `GET` and `PATCH /repos/:owner/:repo/issues/comments/:id`
  read and edit a comment of the repository's issues and pull requests by id, and answer 404 for
  any other id. An edit replaces the body and moves `updated_at`.
- `GithubApiMock.workflows` and `workflowRuns`: workflows by id and their runs by id, read
  through `GET /repos/:owner/:repo/actions/workflows`, the same path with an id or file name,
  and its `/runs`, newest run first. A workflow without runs, or one nobody seeded, has an
  empty run list, as before the event that starts a case. A run reads at `/actions/runs/:id`
  and has `/jobs`, `/artifacts`, `/timing`, and `/logs`. Its `jobs` and `artifacts` are ids under
  the run id (`runId * 100 + position + 1`), so `/actions/jobs/:id` and
  `/actions/artifacts/:id/zip` find them. The run logs, job logs, and artifact routes answer a
  302 with a `location` on the port the fake listens on, not on the stack's router: a download
  carries no credentials for the router to route by. The fake serves the job logs one, with the
  `logs` text of the job, and not the two archives. The fake runs no workflow, but it starts
  runs: a dispatch (`POST /actions/workflows/:id/dispatches`) adds a `workflow_dispatch` run
  to `workflowRuns`, titled by the workflow's `runName`, with one job. The workflow's
  `outcomeInput` names the dispatch input that picks the outcome: `fail` ends the run as failed,
  `wait` leaves it in progress, and anything else ends it as succeeded. Cancel, rerun, rerun of
  the failed jobs (each adds an attempt and applies the outcome again), and deletion of the run
  logs (the log routes then answer 404) change the run the same way.
- `GithubApiMock.commits`: commits by id, with their repository, message, parents, check runs, and
  statuses. They are fixtures, not git objects, so a test gives a branch the ids a real
  repository holds. `branchHeads` maps a branch name to its tip. `GET /branches/:branch`,
  `/commits/:ref` (an id or a branch name), its `/status` and `/check-runs`, and
  `/compare/:base...:head` read them; a comparison follows every parent, so it answers the
  commits the head has past the base, or 404 when the two share no commit. A history with merge
  commits compares as `ahead`, `behind`, or `diverged`. A pull request
  lists its `commits` by id, and its `files`, `reviews`, and `comments` as seeded: the diff media
  type of `GET /pulls/:number` builds the diff from the files, and `/pulls/:number/comments`
  lists the comments of its `reviewThreads`. The Git database writes join the same state:
  `POST /git/refs` creates a branch in `branchHeads`, `DELETE /git/refs/heads/:branch` removes it,
  `GET /git/ref/heads/:branch` reads it, and a commit made with `POST /git/commits` is a verified
  commit of `commits`, whose blob ids are the real Git hashes. Merging a pull request makes a commit
  on its base branch, and `PUT /pulls/:number/update-branch` merges the base into the head branch,
  when both tips are in `commits`. A check run created with `POST /check-runs` joins the
  `checkRuns` of its commit, and `PATCH /check-runs/:id` changes it, unless the fake was given
  a `checkRunCreateResponse`, which it answers instead. A review created with
  `POST /pulls/:number/reviews` is `PENDING` without an `event`, and a pull request holds one pending review of the app at a time;
  `POST /reviews/:id/events` submits it and `DELETE /reviews/:id` discards it with its threads.
  GraphQL's `addPullRequestReviewThread` starts a thread on a pending review.
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
  `github.create_issue_comment`, `github.update_issue_comment`, and
  `github.resolve_review_thread`, plus
  `github.update_pull_request_branch`, `github.create_review`, `github.submit_review`,
  `github.delete_review`, and `github.add_review_thread`. The other writes are `github.create_issue`,
  `github.add_sub_issue`, `github.remove_sub_issue`, `github.reprioritize_sub_issue`,
  `github.create_branch` (`owner/repo:branch`), `github.delete_branch`, `github.create_commit`
  (when the branch moves), `github.create_check_run`, `github.update_check_run`,
  `github.dispatch_workflow`, `github.cancel_workflow_run`, `github.rerun_workflow_run`,
  `github.rerun_failed_jobs`, and `github.delete_workflow_run_logs`. Issue writes are
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
