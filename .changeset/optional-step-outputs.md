---
"@shipfox/expression": minor
"@shipfox/api-workflows": patch
---

Adds an optional `required` flag to step output declarations. When a declaration sets `required: false`, `coerceStepOutputs` accepts a result without that output and still type-checks the value when it is present. Declarations without the flag stay required. Expressions can check an optional output with `has()`. Reading an absent output raises the existing missing-path error.

The workflows step reader now keeps `required` when it reads output declarations from step config.
