---
"@shipfox/workflow-templates": patch
"@shipfox/api-definitions": minor
"@shipfox/expression": minor
---

Rejects a step `if` that reads `execution.failed` unless the step sets `run_after: always`, and exports `referencesExecutionFailed` from `@shipfox/expression`. The shipped templates now use `run_after` for their failure handlers and drop the `!execution.failed` and `needs.all(n, n.status == "succeeded")` guards it makes redundant.
