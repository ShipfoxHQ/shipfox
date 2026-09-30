---
'@shipfox/api-agent-access': minor
'@shipfox/api-integration-shipfox': minor
'@shipfox/api-triggers-dto': minor
---

Names what is missing in MCP tool errors when a run cannot start. `fire_manual_trigger` and `create_dev_run` include the variable key and where it is read, the trigger secret key, runner labels and size figures in the error message and details. `start_workflow_run` does the same. The `interpolation-unresolvable` error from Triggers now carries the optional `variableKey`, `jobKey` and `step`.
