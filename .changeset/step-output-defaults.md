---
"@shipfox/workflow-document": minor
"@shipfox/expression": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": patch
"@shipfox/api-workflows": patch
---

Run and agent step output declarations accept a `default`. When a step has no value for an output, for example because it was skipped or its run step succeeded without writing it, later steps and job outputs read the default from `steps.<key>.outputs`. A default that does not match its declared type or `schema` fails sync. `steps.<key>.outputs` now reads the step's current attempt, so a step that a gate restart skips on the rerun no longer shows the previous pass's values, and it is `{}` before the step's first attempt finishes.
