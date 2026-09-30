# @shipfox/e2e-driver-github

A fake GitHub API for E2E suites. It stands in for `api.github.com` at the address
the API reads from `GITHUB_API_BASE_URL`, so suites exercise the real GitHub
integration against deterministic responses. Faking GitHub is on purpose: it is the
external system under integration, exactly like Gitea for `@shipfox/e2e-driver-gitea`.

## Public API

- `startGithubApiMock(options?)`: start the fake and return a `GithubApiMock`. It
  serves installation tokens, repository and issue reads, pull request create,
  list, read, update, and merge, review comment replies, issue comments, issue
  search, GraphQL review threads and `createCommitOnBranch`, issue creation, and
  check runs. Waits for the port when a spec in another worker holds it. Git
  transport needs `git` on the `PATH`.
- `GithubApiMock.calls`: every request the fake handled, as `GithubApiMockCall`
  entries in arrival order.
- `GithubApiMock.pullRequests`, `reviewThreads`, and `branchHeads`: state a test
  seeds once it knows the commits. Pull requests created through the API land in
  `pullRequests`, and replies and thread resolution update `reviewThreads`.
- `GithubApiMock.addRepository(params)`: creates a bare repository, seeded from a
  directory, and serves it over git smart HTTP at
  `<endpoint>/github.com/<owner>/<repo>.git`. The repository API returns that URL as
  `clone_url`, so `git remote get-url origin` keeps the `github.com/<owner>/<repo>`
  identity that templates parse. Git requests need the token the fake mints, as
  basic auth with the password set to the token.
- `GithubApiMock.writes()`: the accepted state-changing requests as `RecordedWrite`
  entries (`kind`, `target`, `payload`) in arrival order. A request that GitHub
  would reject is not recorded. `target` is `owner/repo#<number>` for pull
  request writes. It records these kinds:
  `github.create_pull_request`, `github.update_pull_request`,
  `github.merge_pull_request`, `github.reply_to_review_comment`,
  `github.create_issue_comment`, and `github.resolve_review_thread`. Each branch update from a git push is a `push`
  write with `repository`, `branch`, `before`, and `after`; a missing side is `null`.
  `RecordedWrite` itself lives in `@shipfox/e2e-core`.
- `GITHUB_*_INSTALLATION_TOKEN` and `GITHUB_*_RESULT_MARKER`: constants the suites
  assert on.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-github...
```

## License

MIT
