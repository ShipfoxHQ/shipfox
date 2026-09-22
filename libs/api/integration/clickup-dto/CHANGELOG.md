# @shipfox/api-integration-clickup-dto

## 31.0.0

### Major Changes

- da1114b: Group integration event catalogs into families that carry the payload kind, a JSON Schema of normalized payloads, and family notes. Event entries now reference their family and no longer carry `emittedWhen` or `payloadKind`. Sentry and custom webhook DTOs export the Zod schema of the normalized `event` value.

### Patch Changes

- Updated dependencies [da1114b]
  - @shipfox/api-integration-core-dto@31.0.0

## 30.0.0

### Patch Changes

- Updated dependencies [f05d344]
  - @shipfox/api-integration-core-dto@30.0.0

## 27.2.0

### Patch Changes

- Updated dependencies [0827733]
  - @shipfox/api-integration-core-dto@27.2.0

## 26.0.0

### Patch Changes

- Updated dependencies [6eaacf0]
- Updated dependencies [db054aa]
- Updated dependencies [4a75c26]
  - @shipfox/api-integration-core-dto@26.0.0

## 24.2.0

### Minor Changes

- 6b3bb11: Add ClickUp integration event, webhook, install, and agent-tool contracts.
