---
"@shipfox/client-projects": major
"@shipfox/client-workflows": major
---

The Automations page replaces the Workflows page of every project.

- **Route:** the page lives at `/w/$workspaceSlug/p/$projectSlug/automations`, and the `nav.automations` tab replaces `nav.workflows`. The `/workflows` route is removed with no redirect.
- **Source header:** one line names the repository, its default branch, the latest commit, and the sync state, with a link to the repository on GitHub. It reads `GET /projects/:projectId/config`, so it stays visible while the provider is down. `SourceStrip` is removed.
- **Workflows tab:** the table adds a "Starts on" column and a search over the name, the config path, and the triggers. The page loads every definition page before search turns on.
- **`@shipfox/client-projects`:** adds `useProjectConfigQuery`, `projectConfigQueryOptions`, `getProjectConfig`, and the `ProjectConfig` model. `Definition` gains the required `triggers` field, read from the workflow model.
- **`@shipfox/client-workflows`:** `ProjectWorkflowsPage` becomes `ProjectAutomationsPage`, which also takes `workspaceSlug` and `projectSlug`. The runs empty state links to the Automations page.
