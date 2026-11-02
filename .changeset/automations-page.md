---
"@shipfox/client-projects": major
"@shipfox/client-workflows": major
---

The Automations page replaces the Workflows page of every project.

- **Route:** the page lives at `/w/$workspaceSlug/p/$projectSlug/automations`, and the `nav.automations` tab replaces `nav.workflows`. The `/workflows` route is removed with no redirect.
- **Source header:** one line shows the config source, its default branch, the latest commit when available, and the sync state. A GitHub repository gets an **Open on GitHub** link, and a managed project shows "Managed by Shipfox". `SourceStrip` is removed.
- **Workflows tab:** the table adds a "Starts on" column and a search over the name, the config path, and the triggers.
- **`@shipfox/client-projects`:** adds `useProjectConfigQuery`, `projectConfigQueryOptions`, `getProjectConfig`, and the `ProjectConfig` model. `Definition` gains the required `triggers` field, read from the workflow model.
- **`@shipfox/client-workflows`:** `ProjectWorkflowsPage` becomes `ProjectAutomationsPage`, which also takes `workspaceSlug` and `projectSlug`. The runs empty state links to the Automations page.
