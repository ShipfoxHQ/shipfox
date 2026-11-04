---
"@shipfox/api-workflows": patch
"@shipfox/api-runners": patch
---

Finishes the purge of a deleted project whose `PROJECT_DELETED` event was dead-lettered. Workflows and the Runners maintenance sweep run the purge again every minute for deletion markers with no `purged_at`, so the purge finishes without replaying the event by hand.
