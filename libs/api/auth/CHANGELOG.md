# @shipfox/api-auth

## 0.1.0

### Minor Changes

- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.

### Patch Changes

- 1daf39a: Tolerates concurrent refresh-token reuse within a grace window so parallel browser tabs no longer log each other out, and treats reuse past the window as a session compromise.
- fb64f13: Extracts the HS256 sign/verify mechanics into a shared `@shipfox/node-jwt` package and refactors auth user-token signing onto it, leaving the auth public API unchanged.
- Updated dependencies [c0a883c]
- Updated dependencies [e47f8da]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [fb64f13]
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-auth-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/node-jwt@0.1.0
  - @shipfox/api-workspaces@0.0.1
  - @shipfox/node-mailer@0.1.1
  - @shipfox/node-drizzle@0.0.1
