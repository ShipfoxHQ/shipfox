# @shipfox/api-integration-managed-vcs

## 34.0.0

### Minor Changes

- a64d96d: Agents can write config to a managed project, on branches only. Agent access gains `list_config_files`, `read_config_file`, and `commit_config_changes`; the reads also work on linked projects, and the write answers `repository-read-only` with the repository name for a linked one. The commit creates its branch on first use, refuses the default branch, enforces the path and size rules, and gives one `stale-head` to two racing commits. The create-workflow-from-template skill (revision 15) writes a Shipfox-hosted project's workflow to a branch, tests it, and stops without suggesting a pull request.
- 1872f3d: Move a managed project to a repository.

  - **Routes:** `POST /projects/:projectId/config/link` checks the target and refuses with `config-exists`, `repository-in-use`, `repository-empty`, `connection-inactive`, or `link-unsupported`. With `dry_run: true` it stops there. Otherwise it makes the managed repository read-only, opens a pull request that adds `.shipfox/`, moves the project's config source, and finishes. A stopped move answers `503 move-unconfirmed`, and the next call resumes the stored attempt without opening a second pull request. `POST /projects/:projectId/config/link/pull-request` opens a new one after a closed pull request. Impersonated sessions are refused on both.
  - **Config read:** `GET /projects/:projectId/config` and `getConfigSource` return the move and the pull request state. A merged pull request clears its stored URL.
  - **Providers:** the source-control SPI gains `openConfigPullRequest` and `getConfigPullRequest`, idempotent on the branch. GitHub implements both.
  - **Projects:** the inter-module contract gains `moveProjectSource`, which moves a project's config source to the linked repository.
  - **E2E setup:** `mergeTestVcsPullRequest` and `closeTestVcsPullRequest` drive a Test VCS pull request.

- 0af8bad: Adds projects with a managed repository, behind the `managed-config-repos` workspace flag. `POST /projects` accepts a managed source, the project DTO gains `source.kind`, and the workspace's hidden connection stays out of every list. A job with a default checkout on a managed project now explains how to fix it.
- 27dc317: Adds the read-only `ManagedSourceControlProvider` for managed git repositories stored in Postgres.

### Patch Changes

- Updated dependencies [2062ec8]
- Updated dependencies [8937e15]
- Updated dependencies [c4f486b]
- Updated dependencies [2339c1b]
- Updated dependencies [7cc3735]
- Updated dependencies [2d009f4]
- Updated dependencies [e5872d5]
- Updated dependencies [9e173c3]
- Updated dependencies [f769d90]
- Updated dependencies [15b4274]
- Updated dependencies [9aeb048]
- Updated dependencies [1872f3d]
- Updated dependencies [0af8bad]
- Updated dependencies [27dc317]
- Updated dependencies [c8e0869]
- Updated dependencies [21c993b]
- Updated dependencies [cdb88a7]
- Updated dependencies [f8adab0]
- Updated dependencies [1d94e37]
- Updated dependencies [3fe51c3]
- Updated dependencies [e6981d5]
- Updated dependencies [041ae63]
- Updated dependencies [107ecc7]
- Updated dependencies [27dc317]
- Updated dependencies [e2e561c]
- Updated dependencies [7d9b08a]
- Updated dependencies [82f2480]
  - @shipfox/api-integration-spi@5.0.0
  - @shipfox/regex@0.4.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/api-integration-managed-vcs-dto@34.0.0
  - @shipfox/node-drizzle@0.4.0
  - @shipfox/node-error-monitoring@0.4.1
