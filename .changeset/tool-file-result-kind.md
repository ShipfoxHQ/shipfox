---
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-core": minor
---

Adds a `json` or `file` result kind to agent tool catalog entries. An absent kind means `json`. The connection tool catalog and the agent tools context carry the resolved kind, and the MCP gateway neither lists nor calls file tools.
