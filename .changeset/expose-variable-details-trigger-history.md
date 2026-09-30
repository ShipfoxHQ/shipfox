---
'@shipfox/api-triggers': minor
'@shipfox/api-triggers-dto': minor
'@shipfox/client-triggers': patch
---

Exposes the missing variable in refused manual starts and trigger history. The 422 `workflow-interpolation-unresolvable` details carry optional `variable_key`, `job_key` and `step`. The `interpolation-unresolvable` diagnostic gains optional `variableKey`, `jobKey`, `step` and `source`, and a missing secret input records its own `secret-input-missing` diagnostic instead of `unexpected-workflow-start-failure`. A manual fire that fails on a missing secret is now recorded as a terminal error.
