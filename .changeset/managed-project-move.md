---
"@shipfox/api-integration-managed-vcs": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-github": minor
"@shipfox/api-projects": minor
"@shipfox/api-projects-dto": minor
"@shipfox/e2e-setup-integrations": minor
---

Move a managed project to a repository.

- **Routes:** `POST /projects/:projectId/config/link` checks the target and refuses with `config-exists`, `repository-in-use`, `repository-empty`, `connection-inactive`, or `link-unsupported`. With `dry_run: true` it stops there. Otherwise it makes the managed repository read-only, opens a pull request that adds `.shipfox/`, moves the project's config source, and finishes. A stopped move answers `503 move-unconfirmed`, and the next call resumes the stored attempt without opening a second pull request. `POST /projects/:projectId/config/link/pull-request` opens a new one after a closed pull request. Impersonated sessions are refused on both.
- **Config read:** `GET /projects/:projectId/config` and `getConfigSource` return the move and the pull request state. A merged pull request clears its stored URL.
- **Providers:** the source-control SPI gains `openConfigPullRequest` and `getConfigPullRequest`, idempotent on the branch. GitHub implements both.
- **Projects:** the inter-module contract gains `moveProjectSource`, which moves a project's config source to the linked repository.
- **E2E setup:** `mergeTestVcsPullRequest` and `closeTestVcsPullRequest` drive a Test VCS pull request.
