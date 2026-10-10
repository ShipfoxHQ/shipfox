---
"@shipfox/api-agent-access": major
---

Removes the `agentAccessModule` export. It built a module with no clients at import time, so importing the package threw when `AGENT_ACCESS_ADMIN_MCP_ENABLED` was `true`. Call `createAgentAccessModule(options)` instead.
