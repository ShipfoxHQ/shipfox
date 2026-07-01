# @shipfox/api-projects

## 0.0.1

### Patch Changes

- 115655e: Moves source-event translation to the integration module: source-control providers emit a typed, provider-agnostic `INTEGRATION_SOURCE_COMMIT_PUSHED` event via one transactional publisher, projects subscribes to it instead of decoding GitHub payloads, and branch-deletion pushes are dropped at the source.
- 72ce351: Removes the legacy workspace API-key auth surface, its DTOs, project-access branch, database table, and token prefix support.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- Updated dependencies [34ba284]
- Updated dependencies [b9c3f32]
- Updated dependencies [d02c5fd]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [a68ed61]
- Updated dependencies [7b175f5]
- Updated dependencies [fd83878]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [f8f339a]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [75520ff]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
- Updated dependencies [9c149d1]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-workspaces@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-integration-core@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-projects-dto@0.0.1
