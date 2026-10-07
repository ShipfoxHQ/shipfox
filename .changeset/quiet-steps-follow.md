---
"@shipfox/workflow-document": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-workflows": minor
---

Adds `run_after` to steps and jobs. Set it to `success`, `failure`, or `always` to choose when a step or job runs after an earlier failure. It defaults to `success`, and an `if` now adds to it instead of replacing it. Workflows stored before this change keep their current behavior until their file is next synced.
