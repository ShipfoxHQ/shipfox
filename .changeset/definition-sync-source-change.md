---
'@shipfox/api-definitions': patch
---

Keeps definition sync safe when a project's source changes. A sync started for a source the project has left now changes nothing, and each bind sync is keyed by its source. Live definitions follow a renamed default branch and keep their ids, trigger subscriptions, and cron schedules.
