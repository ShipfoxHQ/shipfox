# @shipfox/e2e-setup-integrations

## 34.0.0

### Minor Changes

- c065564: Adds a Claap fake to the E2E harness at `CLAAP_MCP_ENDPOINT`, and a `createClaapConnection` setup helper.
- 8736f2d: Reinstalling the Shipfox GitHub App for the same GitHub account in a workspace reattaches the existing connection instead of creating `github_<owner>_2`. Its ID, slug, project bindings, and workflows stay, and a disabled or errored connection becomes `active` again, or stays `error` if GitHub reports the new installation suspended. Installations record GitHub's account ID, and the E2E connect route accepts one.
- e5eff24: Adds a Jam fake to the E2E harness, a `createJamConnection` setup helper, and an `image_content_present` request assertion for fake model provider scripts.
- 1872f3d: Move a managed project to a repository.

  - **Routes:** `POST /projects/:projectId/config/link` checks the target and refuses with `config-exists`, `repository-in-use`, `repository-empty`, `connection-inactive`, or `link-unsupported`. With `dry_run: true` it stops there. Otherwise it makes the managed repository read-only, opens a pull request that adds `.shipfox/`, moves the project's config source, and finishes. A stopped move answers `503 move-unconfirmed`, and the next call resumes the stored attempt without opening a second pull request. `POST /projects/:projectId/config/link/pull-request` opens a new one after a closed pull request. Impersonated sessions are refused on both.
  - **Config read:** `GET /projects/:projectId/config` and `getConfigSource` return the move and the pull request state. A merged pull request clears its stored URL.
  - **Providers:** the source-control SPI gains `openConfigPullRequest` and `getConfigPullRequest`, idempotent on the branch. GitHub implements both.
  - **Projects:** the inter-module contract gains `moveProjectSource`, which moves a project's config source to the linked repository.
  - **E2E setup:** `mergeTestVcsPullRequest` and `closeTestVcsPullRequest` drive a Test VCS pull request.

- b42874e: Publishes the E2E setup packages and the workflows observation, and exports `parseSetCookie` from `@shipfox/e2e-setup-auth`.

### Patch Changes

- Updated dependencies [2062ec8]
- Updated dependencies [0363a2c]
- Updated dependencies [1fa56a2]
- Updated dependencies [c64d42f]
- Updated dependencies [c4f486b]
- Updated dependencies [b183992]
- Updated dependencies [23a6b3a]
- Updated dependencies [23a6b3a]
- Updated dependencies [2cc76a9]
- Updated dependencies [2339c1b]
- Updated dependencies [7cc3735]
- Updated dependencies [9e7dd0e]
- Updated dependencies [b59424d]
- Updated dependencies [a02f5cf]
- Updated dependencies [eec818d]
- Updated dependencies [4273dad]
- Updated dependencies [474e21f]
- Updated dependencies [5e12647]
- Updated dependencies [9e173c3]
- Updated dependencies [8736f2d]
- Updated dependencies [b92d2a8]
- Updated dependencies [3022de6]
- Updated dependencies [f769d90]
- Updated dependencies [15b4274]
- Updated dependencies [2b3aded]
- Updated dependencies [f769d90]
- Updated dependencies [b4c1fa2]
- Updated dependencies [3726d36]
- Updated dependencies [a64d96d]
- Updated dependencies [1872f3d]
- Updated dependencies [0af8bad]
- Updated dependencies [a020cbf]
- Updated dependencies [900a25a]
- Updated dependencies [cdb88a7]
- Updated dependencies [3fe51c3]
- Updated dependencies [e6981d5]
- Updated dependencies [9f27c98]
- Updated dependencies [107ecc7]
- Updated dependencies [e2e561c]
- Updated dependencies [9485c57]
- Updated dependencies [82f2480]
  - @shipfox/api-integration-core-dto@34.0.0
  - @shipfox/api-integration-github-dto@34.0.0
  - @shipfox/api-integration-claap-dto@34.0.0
  - @shipfox/api-integration-clickup-dto@34.0.0
  - @shipfox/api-integration-discord-dto@34.0.0
  - @shipfox/api-integration-jam-dto@34.0.0
  - @shipfox/api-integration-jira-dto@34.0.0
  - @shipfox/api-integration-sentry-dto@34.0.0
  - @shipfox/api-integration-slack-dto@34.0.0
  - @shipfox/api-integration-linear-dto@34.0.0
  - @shipfox/api-integration-notion-dto@34.0.0
  - @shipfox/api-integration-posthog-dto@34.0.0
