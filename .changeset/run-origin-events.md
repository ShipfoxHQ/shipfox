---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

The `workflows.workflow_run_attempt.created` and `workflows.workflow_run.terminated` events carry the run `origin`, `dev` or `synced`, so consumers can tell dev runs from synced runs without reading the workflows tables. A rerun reports the origin of its source run. The field is optional because events written before this change don't have it.
