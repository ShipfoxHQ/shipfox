# @shipfox/api-integration-webhook

## 0.0.1

### Patch Changes

- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- Updated dependencies [34ba284]
- Updated dependencies [b9c3f32]
- Updated dependencies [861091c]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [ce062a9]
- Updated dependencies [f3614ae]
- Updated dependencies [f92122b]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [82d22e4]
- Updated dependencies [01be723]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-integration-webhook-dto@0.0.1
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/config@1.2.0
