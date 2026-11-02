---
'@shipfox/api-definitions': patch
---

Keeps definition sync safe when a project's source changes. Syncs from a source a project has left no longer modify definitions. Live definitions follow a renamed default branch and preserve their IDs, trigger subscriptions, and cron schedules.
