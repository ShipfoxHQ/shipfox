---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
"@shipfox/api-integration-shipfox": minor
---

Adds `status_reason`, `status_reason_message`, and `outputs` to the run overview attempt. The `shipfox` provider's `get_workflow_run` tool returns them on its attempt, and the agent-access `get_workflow_run` tool returns them on the run. Workflow outputs do not count against the overview's job byte budget.
