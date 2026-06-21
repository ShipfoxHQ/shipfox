---
"@shipfox/api-integration-github": patch
"@shipfox/api-integration-gitea": patch
---

Skip publishing source pushes for non-active integration connections. Both the GitHub and Gitea push webhook handlers now treat a connection whose `lifecycleStatus` is not `active` (disabled/error) like an unknown one: the delivery is recorded for dedup but no source-push event is published, so a disabled connection no longer triggers workflow runs.
