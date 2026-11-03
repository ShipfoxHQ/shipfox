---
"@shipfox/client-projects": minor
"@shipfox/client-workflows": minor
---

The Automations page gains a Files tab with file history.

- **Files tab:** the `.shipfox/` tree on the default branch, pinned to the head commit, beside a read-only viewer at `/w/$workspaceSlug/p/$projectSlug/automations/files/*`. Symbolic links, submodules, files over 1 MB, files that aren't text, and failed reads each show their own state.
- **History:** a `Code | History` toggle, kept in the `view=history` search parameter, lists the commits that changed a file. A selected folder lists its history, so `.shipfox` shows every config change. Rows open the commit when the provider has a page for it, and History is hidden when the provider can't list commits.
- **Links:** a file names the workflow that uses it. On the Workflows tab, `View file`, the "Updated" cell, and sync diagnostics open the file.
- **`@shipfox/client-projects`:** adds `useProjectConfigFilesQuery`, `useProjectConfigFileQuery`, `useProjectConfigCommitsInfiniteQuery`, their query options and request functions, and the `ConfigFileEntry`, `ConfigFile`, and `ConfigCommit` models.
- **`@shipfox/client-workflows`:** `ProjectAutomationsPage` takes an optional `tab`.
