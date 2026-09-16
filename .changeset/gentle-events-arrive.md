---
"@shipfox/api-integration-clickup": patch
"@shipfox/api-integration-jira": patch
"@shipfox/api-integration-slack": patch
---

Publishes supported events even when the connected account created them.
Workflows that write back through an integration can trigger another run from their own changes.
