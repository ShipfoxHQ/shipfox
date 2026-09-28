---
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
---

Adds `GET /workspaces/:workspaceId/workflow-templates` for workspace members. It lists workflow templates grouped as `try_now`, `starts_on_event`, or `needs_connection`, ordered by template rank, each with its providers, missing providers, and setup prompt. The response schema is `listWorkspaceWorkflowTemplatesResponseSchema`. The route shares its compatibility check with `list_workflow_templates`, whose output is unchanged. The MCP server instructions now tell agents to follow the `create-workflow-from-template` skill when the user asks to create, set up, or suggest a workflow.
