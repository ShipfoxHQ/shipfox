---
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
---

Serves every read-only workspace tool on the admin MCP endpoint `POST /mcp/admin`, with the same name and behavior as on `/mcp` plus a required `workspace_id`. Each call requires the `admin-operator` role and an open impersonation window on that workspace; role failures return `admin-role-required`, and calls without an open window return `impersonation-window-closed`. The tool runs as the administrator in the named workspace and never sees `workspace_id`. Action tools and `get_step_log_download` are not served. Audit records include the administrator and the resolved window; closed-window attempts record the administrator and the target workspace.
