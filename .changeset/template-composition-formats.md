---
"@shipfox/workflow-templates": minor
---

Adds composition formats. `composeTemplate` and `applyTemplateOptions` take a `composition` number, defaulting to the current format, and the package exports `SUPPORTED_COMPOSITIONS`, `CURRENT_COMPOSITION`, and `UnsupportedCompositionError`. An unsupported format throws. Format 1 is the composer's current behavior, so output is unchanged. A golden corpus in `test/golden/` freezes the composer's output for a fixture template that exercises every composer behavior, and a test compares the composer with it byte for byte.
