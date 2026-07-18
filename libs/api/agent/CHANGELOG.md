# @shipfox/api-agent

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/node-module@0.3.1

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- Updated dependencies [3976f8c]
- Updated dependencies [7a71e7d]
  - @shipfox/node-module@0.3.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-secrets@3.0.0
  - @shipfox/api-agent-dto@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-secrets@2.0.0
  - @shipfox/node-egress-guard@0.1.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-postgres@0.4.1
  - @shipfox/redact@0.2.1

## 0.1.2

### Patch Changes

- @shipfox/api-secrets@0.1.2
- @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [68b8d03]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/redact@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-secrets@0.1.1
  - @shipfox/node-module@0.1.1

## 0.1.0

### Minor Changes

- 0a6318f: Adds backend model provider storage with workspace defaults and Pi catalog registry validation.
- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- 5bcdbf4: Adds harness-native agent tool catalogs with deployment-aware Pi optional tool package config.

### Patch Changes

- 5cdfc69: Adds a reusable custom-model-provider egress guard with instance config for private-network and host-denylist policy.
- b1f57d1: Moves agent model provider credentials onto the shared secrets store while keeping provider config metadata and runtime resolution behavior intact.
- 97162dd: Resolves model provider, model, and thinking defaults at workflow run creation using workspace and instance configuration.
- aca162b: Add workspace model provider management routes: list provider catalog, list workspace provider configs, test-and-save (upsert) a provider configuration, hard-delete a configuration (clearing the workspace default when needed), and set the workspace default provider. Routes carry per-route error translation and never expose stored credentials.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- Updated dependencies [067a260]
- Updated dependencies [34ba284]
- Updated dependencies [3b45d86]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [de54da2]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [5bcdbf4]
- Updated dependencies [ae7a63c]
- Updated dependencies [f92122b]
- Updated dependencies [360d06d]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [aca162b]
- Updated dependencies [75520ff]
- Updated dependencies [f66f606]
- Updated dependencies [e51d464]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
- Updated dependencies [282e66a]
- Updated dependencies [9c149d1]
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-secrets@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/redact@0.1.0
  - @shipfox/config@1.2.0
  - @shipfox/node-egress-guard@0.0.0
