---
"@shipfox/api-agent-access": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/workflow-templates": patch
---

Adds the `check_workflow` read tool. It checks a pushed or local workflow file and reports how one of its triggers would have handled up to 50 past events. It writes nothing and starts no run.

- **Tool:** `check_workflow` takes `project_id`, `config_path`, and `ref` or `content`. It also accepts `actions`, `commit`, and a `trigger` with `event_ids`. An invalid definition is a result with `valid: false` and its errors, not an error. Each event gets one result: `matched`, `filtered`, `filter-error`, `event-mismatch`, `payload-unavailable`, or `not-found`. The admin MCP endpoint serves it like the other read tools.
- **Definitions:** `validateDefinitionAtRef` checks a definition the way `resolveDefinitionAtRef` does, and writes nothing. It requires `workspaceId` and answers `project-not-found` for a project in another workspace.
- **Triggers:** `checkWorkflow` checks project ownership, then checks events with the same rules as dispatch. `create_dev_run` with `dry_run: true` uses the same validation, so a dry run writes nothing either.
- **Skills:** `validate-workflow-change` uses `check_workflow` instead of a dry run.
