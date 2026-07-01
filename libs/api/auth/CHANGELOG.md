# @shipfox/api-auth

## 0.1.0

### Minor Changes

- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.

### Patch Changes

- d02c5fd: Queues auth and workspace transactional emails through module-owned outbox events so account verification, password reset, and invitation sends retry outside request transactions.
- e250c4c: Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
- b0a0e1a: Expose the auth `config` object through a new `@shipfox/api-auth/config` subpath export, so a module that already depends on auth can read auth-owned settings (such as `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`) without pulling in the full module graph from the package root.
- 1daf39a: Tolerates concurrent refresh-token reuse within a grace window so parallel browser tabs no longer log each other out, and treats reuse past the window as a session compromise.
- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- fb64f13: Extracts the HS256 sign/verify mechanics into a shared `@shipfox/node-jwt` package and refactors auth user-token signing onto it, leaving the auth public API unchanged.
- Updated dependencies [cdd8931]
- Updated dependencies [34ba284]
- Updated dependencies [b9c3f32]
- Updated dependencies [d02c5fd]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [b0a0e1a]
- Updated dependencies [857fd73]
- Updated dependencies [3afb7e3]
- Updated dependencies [75520ff]
- Updated dependencies [4798517]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [27770eb]
- Updated dependencies [6181819]
- Updated dependencies [9c149d1]
- Updated dependencies [fb64f13]
  - @shipfox/node-email@0.2.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-auth-dto@1.0.0
  - @shipfox/api-workspaces-dto@0.1.0
  - @shipfox/api-workspaces@0.1.0
  - @shipfox/node-tokens@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-jwt@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/node-mailer@0.1.1
  - @shipfox/config@1.2.0
