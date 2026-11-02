---
"@shipfox/api-integration-managed-vcs": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-github": minor
"@shipfox/api-projects": minor
"@shipfox/api-projects-dto": minor
---

Move a managed project to a repository.

- **Routes:** `POST /projects/:projectId/config/link` checks the target, and with `dry_run: true` stops there. Otherwise it makes the managed repository read-only, opens a pull request that adds `.shipfox/`, moves the project's config source, and finishes. A stopped move resumes on the next call and never opens a second pull request. `POST /projects/:projectId/config/link/pull-request` opens a new one after a closed pull request.
- **Config read:** `GET /projects/:projectId/config` and `getConfigSource` return the move and the pull request state. A merged pull request clears its stored URL.
- **Providers:** the source-control SPI gains `openConfigPullRequest` and `getConfigPullRequest`, idempotent on the branch. GitHub implements both with a signed commit.
- **Projects:** `moveProjectSource` is a compare-and-set that writes `PROJECT_SOURCE_BOUND`.
