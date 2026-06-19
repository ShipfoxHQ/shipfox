---
"@shipfox/client-workflows": patch
---

Capture the `@shipfox/client-workflows` Storybook stories as Argos visual
snapshots. Vitest now runs a browser `storybook` project that screenshots every
story in light and dark and uploads them to the `client-workflows` Argos build
in CI.
