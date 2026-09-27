---
"@shipfox/api-integration-shipfox": patch
---

Shipfox read tools now work as `tool:` steps. Their input schemas use patterns instead of the `uuid` and `date-time` formats, which the strict tool step validator rejected before any call. `get_step_logs` with `failed_only` no longer returns an undeclared `step_attempt` field that failed output validation.
