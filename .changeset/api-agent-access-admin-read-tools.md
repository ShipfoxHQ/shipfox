---
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
---

Serves every read-only workspace tool on the admin MCP endpoint `POST /mcp/admin`, with the same name and behavior as on `/mcp` plus a required `workspace_id`. Each call needs the `admin-operator` role and an open impersonation window on that workspace, otherwise it returns `impersonation-window-closed`. The tool runs as the administrator in the named workspace and never sees `workspace_id`. Action tools and `get_step_log_download` are not served, and the audit line carries the administrator and the window for every outcome.
