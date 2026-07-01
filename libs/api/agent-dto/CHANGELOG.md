# @shipfox/api-agent-dto

## 0.1.0

### Minor Changes

- 067a260: Adds workspace agent provider settings for configuring, testing, defaulting, and deleting provider credentials.
- de54da2: Adds agent provider catalog and provider configuration DTO contracts for backend-managed agent credentials.

### Patch Changes

- 62c25a5: Add workspace agent provider management routes: list provider catalog, list workspace provider configs, test-and-save (upsert) a provider configuration, hard-delete a configuration (clearing the workspace default when needed), and set the workspace default provider. Routes carry per-route error translation and never expose stored credentials.
- Updated dependencies [eb40964]
- Updated dependencies [e9056c7]
- Updated dependencies [b525dcd]
- Updated dependencies [3afb7e3]
- Updated dependencies [eb7d5e8]
- Updated dependencies [69d02e5]
- Updated dependencies [f63c6b0]
- Updated dependencies [ef1e917]
- Updated dependencies [f88aac9]
  - @shipfox/workflow-document@1.1.0
