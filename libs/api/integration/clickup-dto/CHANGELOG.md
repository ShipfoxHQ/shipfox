# @shipfox/api-integration-clickup-dto

## 34.0.0

### Minor Changes

- 23a6b3a: Add the `add_tag`, `remove_tag`, and `set_custom_field` ClickUp tools. A workflow can now record its state on a task in tags, and write a result to a custom field instead of the description. `add_tag` creates the tag in the task's Space when it doesn't exist. The generated action tool types include the new tools.

### Patch Changes

- 23a6b3a: ClickUp webhook deliveries whose change records leave out `data`, `source`, `before`, or `after`, or whose user has a `null` username, email, or initials, now pass validation. ClickUp leaves `before` out when a tag is added, so tag events were dropped before they reached a trigger. A trigger filter that reads `after` should check `has(item.after)` first.
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
