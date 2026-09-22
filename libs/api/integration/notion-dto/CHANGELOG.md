# @shipfox/api-integration-notion-dto

## 31.0.0

### Major Changes

- da1114b: Group integration event catalogs into families that carry the payload kind, a JSON Schema of normalized payloads, and family notes. Event entries now reference their family and no longer carry `emittedWhen` or `payloadKind`. Sentry and custom webhook DTOs export the Zod schema of the normalized `event` value.

### Minor Changes

- e9a13b2: Adds an exact 200 response schema for Notion OAuth callbacks.

### Patch Changes

- Updated dependencies [da1114b]
  - @shipfox/api-integration-core-dto@31.0.0

## 30.0.0

### Patch Changes

- f05d344: Adds the flag-gated Notion provider scaffold. The stored-request contract accepts the Notion webhook route. The seed contract requires UUID identifiers. Workflow failure annotations show the Notion provider name.
- Updated dependencies [f05d344]
  - @shipfox/api-integration-core-dto@30.0.0

## 27.2.0

### Minor Changes

- 1bd3f0e: Add the Notion integration provider, event, webhook, install, tool, and E2E seed contracts.

### Patch Changes

- Updated dependencies [0827733]
  - @shipfox/api-integration-core-dto@27.2.0
