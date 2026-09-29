# @shipfox/e2e-driver-github

A fake GitHub API for E2E suites. It stands in for `api.github.com` at the address
the API reads from `GITHUB_API_BASE_URL`, so suites exercise the real GitHub
integration against deterministic responses. Faking GitHub is on purpose: it is the
external system under integration, exactly like Gitea for `@shipfox/e2e-driver-gitea`.

## Public API

- `startGithubApiMock(options?)`: start the fake and return a `GithubApiMock`. It
  serves installation tokens, repository and issue reads, pull request reads,
  issue search, GraphQL `createCommitOnBranch`, issue creation, and check runs.
  Waits for the port when a spec in another worker holds it.
- `GithubApiMock.calls`: every request the fake handled, as `GithubApiMockCall`
  entries in arrival order.
- `GithubApiMock.pullRequests` and `branchHeads`: fixtures a test fills once it
  knows the commits.
- `GithubApiMock.writes()`: the accepted state-changing requests as `RecordedWrite`
  entries (`kind`, `target`, `payload`). It returns an empty list until the
  recorded-write units fill it.
- `GITHUB_*_INSTALLATION_TOKEN` and `GITHUB_*_RESULT_MARKER`: constants the suites
  assert on.

## Local Checks

```sh
mise exec -- turbo check type test --filter=@shipfox/e2e-driver-github...
```

## License

MIT
