---
"@shipfox/api-agent-dto": minor
"@shipfox/client-logs": minor
"@shipfox/client-workflows": patch
---

Claude now names integration tools `mcp__shipfox__<connection>__<tool>`, which leaves more room under its 64-character tool-name limit.

- **Agent DTO:** `AGENT_TOOLS_MCP_SERVER_ID` names the server that harnesses see. The persisted descriptor name `shipfox_integration_tools` does not change, so older runners and stored configs keep working.
- **Logs:** `withoutClaudeIntegrationPrefix` strips the new prefix and the legacy `mcp__shipfox_integration_tools__` prefix, so older transcripts still show their integration tools.
