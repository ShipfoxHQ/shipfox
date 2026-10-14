---
"@shipfox/api-auth-dto": minor
"@shipfox/api-auth": minor
"@shipfox/api-agent-access": minor
---

Serves `get_step_log_download` on the admin MCP endpoint `POST /mcp/admin`. The download token minted there carries the administrator's impersonation window in the new optional `impersonationWindowId` claim, which `mintAgentLogDownloadToken` now accepts. Each download with such a token checks for an active grant, the `admin-operator` role, and that window still open on the token's workspace. These checks replace the grant-workspace and membership checks. Stopping the window or reaching its deadline rejects further downloads with `401`.
