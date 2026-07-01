# @shipfox/client-ui

## 0.1.0

### Minor Changes

- 24f131b: Standardize "failed to load" states across client surfaces. Adds an `EmptyState`
  primitive and a presentational `LoadErrorState` to `@shipfox/react-ui`, and a new
  `@shipfox/client-ui` package with `loadErrorCopy` (friendly, leak-free error copy)
  and a `QueryLoadError` wrapper. Failed data loads now render a calm placeholder
  with a labeled Retry instead of a red alert that leaked the raw request URL, and
  the placeholder is only shown when no data was ever loaded so a failed refetch no
  longer wipes stale content.

### Patch Changes

- 27770eb: Tightens signup, workspace, and project display-name validation with shared trimming, control and format-character rejection, length limits, and contextual client form errors.
- Updated dependencies [14e0bea]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [2a3193f]
- Updated dependencies [7b175f5]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [e4c6abf]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [24f131b]
- Updated dependencies [bb2a7bc]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [f849131]
- Updated dependencies [94bdcc5]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/react-ui@0.3.0
  - @shipfox/regex@0.2.0
  - @shipfox/client-api@0.0.0
