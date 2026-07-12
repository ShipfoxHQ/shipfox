# @shipfox/api-workspaces

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- a81b68c: Adds provisioner token and auth context primitives for workspace-scoped control-plane credentials.

### Patch Changes

- d02c5fd: Queues auth and workspace transactional emails through module-owned outbox events so account verification, password reset, and invitation sends retry outside request transactions.
- 72ce351: Removes the legacy workspace API-key auth surface, its DTOs, project-access branch, database table, and token prefix support.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- Updated dependencies [cdd8931]
- Updated dependencies [34ba284]
- Updated dependencies [5707d6d]
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
- Updated dependencies [857fd73]
- Updated dependencies [75520ff]
- Updated dependencies [4798517]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [27770eb]
- Updated dependencies [6181819]
- Updated dependencies [9c149d1]
  - @shipfox/node-email@0.2.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-workspaces-dto@0.1.0
  - @shipfox/node-tokens@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-mailer@0.1.1
  - @shipfox/config@1.2.0
