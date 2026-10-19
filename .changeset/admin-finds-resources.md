---
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-workspaces": minor
"@shipfox/api-workspaces-dto": minor
"@shipfox/api-projects": minor
"@shipfox/api-projects-dto": minor
---

Adds `find_workspaces` and `find_projects` to the admin MCP endpoint `POST /mcp/admin`. Both need the `admin-observer` role and no impersonation window. `search` matches part of a name or slug, or an exact ID when it is a UUID. Leave it out to list every workspace or project. `find_workspaces` also filters by `status`. Each project names its `workspace_id` and `workspace_slug` for `start_impersonation`. The admin endpoint now needs a projects client. The Workspaces contract adds `listAdminWorkspaces`, and the Projects contract adds `listAdminProjects`. The `GET /admin/workspaces` and `GET /admin/projects` searches now match slugs as well as names.
