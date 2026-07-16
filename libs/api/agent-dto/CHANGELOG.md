# @shipfox/api-agent-dto

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/workflow-document@2.0.1

## 0.1.0

### Minor Changes

- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- de54da2: Adds model provider catalog and provider configuration DTO contracts for backend-managed agent credentials.
- 7ca4c65: Adds step-level agent tool selection to the workflow document contract with shared harness tool deployment helpers.
- 5bcdbf4: Adds harness-native agent tool catalogs with deployment-aware Pi optional tool package config.

### Patch Changes

- aca162b: Add workspace model provider management routes: list provider catalog, list workspace provider configs, test-and-save (upsert) a provider configuration, hard-delete a configuration (clearing the workspace default when needed), and set the workspace default provider. Routes carry per-route error translation and never expose stored credentials.
- 282e66a: Exposes frozen agent integration tool selections as non-secret MCP server descriptors in materialized step config.
- Updated dependencies [eb40964]
- Updated dependencies [e7b01dd]
- Updated dependencies [9086e65]
- Updated dependencies [7ca4c65]
- Updated dependencies [e9056c7]
- Updated dependencies [8e9c6cb]
- Updated dependencies [b525dcd]
- Updated dependencies [3afb7e3]
- Updated dependencies [eb7d5e8]
- Updated dependencies [e87731a]
- Updated dependencies [f85b223]
- Updated dependencies [f0afdf8]
- Updated dependencies [69d02e5]
- Updated dependencies [f63c6b0]
- Updated dependencies [9a5aac4]
- Updated dependencies [30d1c82]
- Updated dependencies [ef1e917]
- Updated dependencies [a314b05]
- Updated dependencies [f88aac9]
- Updated dependencies [a856155]
- Updated dependencies [78527ce]
  - @shipfox/workflow-document@2.0.0
