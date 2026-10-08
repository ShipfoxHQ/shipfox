---
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-auth-context": minor
"@shipfox/api-server": minor
---

Adds the admin MCP endpoint `POST /mcp/admin`, mounted when `AGENT_ACCESS_ADMIN_MCP_ENABLED` is `true` (default `false`). It shares the `/mcp` origin guard, rate limiters, envelope, and OAuth resource, and re-checks the caller's administrator role against the database on every call, returning `admin-role-required` on failure. It serves `find_users`, `start_impersonation`, and `stop_impersonation`, plus any tools passed through the new `additionalAdminTools` option. `AgentAccessContext` gains an optional `admin` marker, and the audit log line carries `adminActorId` and `impersonationWindowId`. The customer `/mcp` endpoint is unchanged.
