# @shipfox/api-agent

## 0.1.0

### Minor Changes

- 0a6318f: Adds backend agent provider storage with workspace defaults and Pi catalog registry validation.
- 067a260: Adds workspace agent provider settings for configuring, testing, defaulting, and deleting provider credentials.

### Patch Changes

- 5cdfc69: Adds a reusable custom-provider egress guard with instance config for private-network and host-denylist policy.
- 97162dd: Resolves agent provider, model, and thinking defaults at workflow run creation using workspace and instance configuration.
- 62c25a5: Add workspace agent provider management routes: list provider catalog, list workspace provider configs, test-and-save (upsert) a provider configuration, hard-delete a configuration (clearing the workspace default when needed), and set the workspace default provider. Routes carry per-route error translation and never expose stored credentials.
- Updated dependencies [067a260]
- Updated dependencies [34ba284]
- Updated dependencies [b9c3f32]
- Updated dependencies [d02c5fd]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [de54da2]
- Updated dependencies [7b175f5]
- Updated dependencies [ae7a63c]
- Updated dependencies [f92122b]
- Updated dependencies [360d06d]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [62c25a5]
- Updated dependencies [75520ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [27770eb]
- Updated dependencies [6181819]
- Updated dependencies [9c149d1]
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-workspaces@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/redact@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/config@1.2.0
