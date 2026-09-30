---
'@shipfox/api-agent-dto': minor
'@shipfox/api-agent': minor
'@shipfox/api-workflows-dto': minor
'@shipfox/api-workflows': minor
'@shipfox/api-triggers-dto': minor
'@shipfox/api-triggers': minor
---

Names the cause of a refused start when an agent step's configuration cannot be used. The agent `agent-config-invalid` error carries a `reason` (`model-unknown`, `provider-unsupported`, `harness-unsupported`, `thinking-unsupported` or `workspace-providers-disabled`) with the `model` and `provider` where they apply. `agent-config-unresolvable` passes them on with the job and step, in the inter-module error, the 422 `details` (`reason`, `model`, `provider`, `job_key`, `step`) and the trigger diagnostic. Every new field is optional, so stored diagnostics still map.
