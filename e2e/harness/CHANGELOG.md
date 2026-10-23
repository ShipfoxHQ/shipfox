# @shipfox/e2e-harness

## 34.0.0

### Minor Changes

- c065564: Adds a Claap fake to the E2E harness at `CLAAP_MCP_ENDPOINT`, and a `createClaapConnection` setup helper.
- 538e591: Exports `startPosthogMock`, `startJamMock`, and `startClaapMock`, so a suite can start these provider doubles in its own process on any port.
- e5eff24: Adds a Jam fake to the E2E harness, a `createJamConnection` setup helper, and an `image_content_present` request assertion for fake model provider scripts.
- a61efd7: Publishes the reusable E2E harness orchestration library.
