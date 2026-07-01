# @shipfox/api-auth-context

## 0.1.0

### Minor Changes

- a81b68c: Adds provisioner token and auth context primitives for workspace-scoped control-plane credentials.
- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.

### Patch Changes

- 72ce351: Removes the legacy workspace API-key auth surface, its DTOs, project-access branch, database table, and token prefix support.
- Updated dependencies [d02c5fd]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e250c4c]
- Updated dependencies [3afb7e3]
- Updated dependencies [27770eb]
- Updated dependencies [6181819]
  - @shipfox/api-auth-dto@1.0.0
  - @shipfox/api-workspaces-dto@0.1.0
