---
'@shipfox/api-agent-access-dto': patch
'@shipfox/api-agent-access': patch
---

Limits `get_workflow_run` `wait_seconds` to 45 seconds. Longer waits sent nothing for 60 seconds, so load balancers and MCP clients cut them off. The tool description says that a wait returns early when the run finishes or a job starts listening. A wait now stops when the client disconnects, and the audit records that call as `client-disconnected` instead of `success`. Tools receive the request's abort signal.
