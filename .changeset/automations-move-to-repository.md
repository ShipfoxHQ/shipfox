---
"@shipfox/client-projects": minor
"@shipfox/client-workflows": minor
"@shipfox/client-integrations": minor
---

The Automations page can move a managed project's config to a repository.

- **Move to your repository:** a managed project's source header offers the move. The dialog picks a connection (skipped when there is only one, with a link to Integrations when there is none) and a repository, with no default selection. Each selection runs the move checks with `dry_run`, and a refusal stays next to the selection, takes focus, and keeps **Continue** disabled. The confirm screen names the repository, its default branch, the file count, and what changes, and says when the repository is public. Progress stays in the dialog until the pull request opens.
- **Source header states:** the header reads the move and the pull request, never a sync error. It shows who is moving the project and where, **Retry** two minutes after a move stopped, the open pull request, **Open a new pull request** after a closed one, and a neutral "Check pull request" banner when the provider doesn't answer. The sync failure alert stays hidden while a move waits for its merge.
- **Files:** the tab explains that files appear once the pull request merges, and a managed project says how its config changes.
- **`@shipfox/client-projects`:** `ProjectConfig` gains `move` and `pullRequest`. Adds `checkProjectConfigMove`, `moveProjectConfig`, `openProjectConfigPullRequest`, their mutation hooks, and `configMoveErrorCopy` with copy for each move refusal.
- **`@shipfox/client-integrations`:** `RepositoryPicker` takes `showDetails` to name each repository by its full name, with its default branch and visibility.
