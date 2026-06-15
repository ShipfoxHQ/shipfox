---
"@shipfox/react-ui": minor
"@shipfox/client-ui": minor
---

Standardize "failed to load" states across client surfaces. Adds an `EmptyState`
primitive and a presentational `LoadErrorState` to `@shipfox/react-ui`, and a new
`@shipfox/client-ui` package with `loadErrorCopy` (friendly, leak-free error copy)
and a `QueryLoadError` wrapper. Failed data loads now render a calm placeholder
with a labeled Retry instead of a red alert that leaked the raw request URL, and
the placeholder is only shown when no data was ever loaded so a failed refetch no
longer wipes stale content.
