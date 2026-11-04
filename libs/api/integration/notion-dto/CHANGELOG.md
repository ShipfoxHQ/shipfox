# @shipfox/api-integration-notion-dto

## 34.0.0

### Patch Changes

- Updated dependencies [2062ec8]
- Updated dependencies [0363a2c]
- Updated dependencies [1fa56a2]
- Updated dependencies [c4f486b]
- Updated dependencies [2cc76a9]
- Updated dependencies [2339c1b]
- Updated dependencies [7cc3735]
- Updated dependencies [b59424d]
- Updated dependencies [4273dad]
- Updated dependencies [9e173c3]
- Updated dependencies [b92d2a8]
- Updated dependencies [3022de6]
- Updated dependencies [f769d90]
- Updated dependencies [15b4274]
- Updated dependencies [a64d96d]
- Updated dependencies [1872f3d]
- Updated dependencies [0af8bad]
- Updated dependencies [a020cbf]
- Updated dependencies [900a25a]
- Updated dependencies [cdb88a7]
- Updated dependencies [3fe51c3]
- Updated dependencies [e6981d5]
- Updated dependencies [107ecc7]
- Updated dependencies [e2e561c]
- Updated dependencies [9485c57]
- Updated dependencies [82f2480]
  - @shipfox/api-integration-core-dto@34.0.0

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
