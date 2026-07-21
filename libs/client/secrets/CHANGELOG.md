# @shipfox/client-secrets

## 3.0.0

### Patch Changes

- Updated dependencies [cb58afe]
  - @shipfox/react-ui@0.3.4
  - @shipfox/client-ui@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [1820feb]
- Updated dependencies [a42b575]
  - @shipfox/react-ui@0.3.3
  - @shipfox/api-secrets-dto@6.0.0
  - @shipfox/client-ui@2.0.0

## 1.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-secrets-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-ui@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.

### Patch Changes

- Updated dependencies [3d064b8]
  - @shipfox/client-api@0.2.0
  - @shipfox/client-ui@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-ui@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-secrets-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- e51d464: Add the Secrets & Variables workspace settings UI (S1b).
  - New `@shipfox/client-secrets` package: transport + React Query hooks (a shared
    `createStoreApi` factory), a write-only secret form and a readable variable form
    (TanStack Form + Zod, multiline `Textarea` values, live short-value / sensitive-name
    advisories), and the workspace secrets/variables sections (single-call list, masked
    secret values, copy-name, delete with blast-radius warning).
  - `@shipfox/client-workspace-settings`: new Secrets and Variables settings pages and nav
    entries.
  - `@shipfox/api-secrets-dto`: export `SECRETS_MAX_LIST_LIMIT` and raise the list `limit`
    cap so the settings UI can fetch the whole bounded set in one request; the variable
    list item now carries `value_truncated`.
  - `@shipfox/api-secrets`: the variable list returns a bounded single-line preview of each
    value (the full value is read via `GET /variables/:key` when editing) so a single-call
    list cannot materialize very large responses; startup fails if `SECRETS_MAX_PER_WORKSPACE`
    exceeds the list limit.
  - `@shipfox/client-router`: register the `/workspaces/$wid/settings/secrets` and
    `/variables` routes.

### Patch Changes

- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [3b45d86]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [2a3193f]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [e4c6abf]
- Updated dependencies [5d0676a]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [24f131b]
- Updated dependencies [bb2a7bc]
- Updated dependencies [f66f606]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [e51d464]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [f849131]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [3ddde91]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-secrets-dto@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
