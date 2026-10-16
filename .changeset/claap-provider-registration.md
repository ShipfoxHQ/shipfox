---
"@shipfox/api-integration-core": minor
"@shipfox/api-server": patch
"@shipfox/actions": minor
"@shipfox/client-logs": patch
---

Registers the Claap provider. The integrations module loads it on every start, with no feature flag, and reads the new `CLAAP_MCP_ENDPOINT` setting. The workflow tool catalog now lists the Claap tools, and run logs show the Claap name.
