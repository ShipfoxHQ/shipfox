---
'@shipfox/api-workflows-dto': minor
'@shipfox/api-agent-access-dto': minor
---

Adds `summary`, `job_key` and `step_index` to the step error. A `config_unresolvable` failure now names the field and reason, and the job and step when the failing field belongs to a step. The message no longer carries a definition id. The `get_step_attempt` MCP tool returns the same fields.
