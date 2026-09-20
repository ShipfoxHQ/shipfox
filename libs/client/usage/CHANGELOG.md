# @shipfox/client-usage

## 48.0.2

### Patch Changes

- Updated dependencies [b7469ab]
- Updated dependencies [32f6eac]
  - @shipfox/react-ui@3.0.0
  - @shipfox/client-shell@48.0.2

## 48.0.1

### Patch Changes

- Updated dependencies [61f3cfb]
  - @shipfox/react-ui@2.6.1
  - @shipfox/client-shell@48.0.1

## 47.0.0

### Patch Changes

- Updated dependencies [33d9ee2]
- Updated dependencies [29247a2]
  - @shipfox/react-ui@2.6.0
  - @shipfox/client-shell@47.0.0

## 46.0.1

### Patch Changes

- Updated dependencies [15f7b58]
- Updated dependencies [3d1afa1]
- Updated dependencies [e0b7bd1]
  - @shipfox/react-ui@2.5.0
  - @shipfox/api-usage-dto@27.1.0
  - @shipfox/client-shell@46.0.1

## 46.0.0

### Major Changes

- 0ddc7ef: Removes the `upstream` provider field, provider-reported token aggregates, and per-step attempt breakdowns from public usage surfaces. Model-scoped pricing reference keys now encode `[model]` instead of `[model, upstream]`.

### Patch Changes

- 34037aa: Remove the pricing disclosure option. Render estimated and resolved usage costs as plain amounts without estimate prefixes or disclosure notices.
- Updated dependencies [34037aa]
- Updated dependencies [0ddc7ef]
  - @shipfox/client-shell@46.0.0
  - @shipfox/api-usage-dto@27.0.0

## 45.0.0

### Patch Changes

- @shipfox/client-shell@45.0.0

## 44.0.0

### Patch Changes

- Updated dependencies [4d3b34b]
- Updated dependencies [b9d7c01]
  - @shipfox/react-ui@2.4.0
  - @shipfox/client-shell@44.0.0

## 43.0.0

### Patch Changes

- 14bc3d6: UsagePricingReference values now require an opaque workspaceId; map/record resolveCosts results must be keyed with usagePricingReferenceKey, and array entries must carry the full matching reference: workspaceId, kind, id, and any model/upstream identity.
- Updated dependencies [14bc3d6]
  - @shipfox/client-shell@43.0.0

## 41.0.0

### Patch Changes

- Updated dependencies [f22cfe7]
  - @shipfox/client-shell@41.0.0
  - @shipfox/client-api@41.0.0

## 40.0.0

### Patch Changes

- Updated dependencies [08a551b]
- Updated dependencies [543f5b2]
- Updated dependencies [72d8146]
- Updated dependencies [543f5b2]
  - @shipfox/client-shell@40.0.0
  - @shipfox/react-ui@2.3.5
  - @shipfox/client-api@40.0.0

## 39.0.0

### Minor Changes

- b4a5de1: Show estimated pricing per model and disclose that it is not billed.

### Patch Changes

- Updated dependencies [b4a5de1]
  - @shipfox/client-shell@39.0.0

## 38.0.0

### Patch Changes

- Updated dependencies [0dbc3f6]
- Updated dependencies [3af9b96]
  - @shipfox/client-shell@38.0.0
  - @shipfox/client-api@38.0.0

## 37.0.0

### Minor Changes

- 7ed04a3: Adds the client pricing seam and usage views to run and job pages.

### Patch Changes

- Updated dependencies [7ed04a3]
  - @shipfox/client-shell@37.0.0
  - @shipfox/api-usage-dto@22.0.0
  - @shipfox/client-api@6.0.1
  - @shipfox/react-ui@2.3.4
