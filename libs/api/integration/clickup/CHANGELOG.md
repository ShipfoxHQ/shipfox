# @shipfox/api-integration-clickup

## 29.0.0

### Patch Changes

- Updated dependencies [a859808]
- Updated dependencies [a34066f]
- Updated dependencies [f4f1f10]
  - @shipfox/api-integration-spi@4.3.1
  - @shipfox/node-fastify@0.4.7
  - @shipfox/node-drizzle@0.3.6
  - @shipfox/api-auth-context@29.0.0

## 27.2.0

### Patch Changes

- Updated dependencies [0827733]
  - @shipfox/api-integration-spi@4.3.0
  - @shipfox/api-integration-clickup-dto@27.2.0

## 27.0.0

### Patch Changes

- f939c8d: Publishes supported events even when the connected account created them.
  Workflows that write back through an integration can trigger another run from their own changes.
  Removes the obsolete `isSelfAuthoredSlackEvent` export and `self-message` outcome.

## 26.1.0

### Patch Changes

- Updated dependencies [c2c97ac]
  - @shipfox/api-integration-spi@4.2.0
  - @shipfox/node-fastify@0.4.6
  - @shipfox/api-auth-context@26.1.0

## 26.0.0

### Minor Changes

- 3fcbb7e: Adds six ClickUp task and comment tools through the agent-tools gateway.
- 9e9a4a4: Connects exactly one ClickUp workspace to a Shipfox workspace through OAuth. The returned workspace becomes the configured workspace, while responses with zero or multiple workspaces are rejected.
- 9c3f38d: Registers one workspace-wide ClickUp webhook per connection and removes it during connection cleanup.
- 4a75c26: Add the signed, connection-scoped ClickUp webhook receiver and event ingestion with delivery deduplication and loop safety.

### Patch Changes

- Updated dependencies [fb73bca]
- Updated dependencies [8229356]
  - @shipfox/api-auth-context@26.0.0
  - @shipfox/api-workspaces-dto@26.0.0
  - @shipfox/api-integration-clickup-dto@26.0.0
  - @shipfox/api-integration-spi@4.1.2
