---
"@shipfox/api-workflows": patch
"@shipfox/api-runners": patch
---

Finishes the purge of a deleted project whose `PROJECT_DELETED` event was dead-lettered. Workflows runs a sweep every minute, and the Runners maintenance sweep takes a step, that run the purge again for each deletion marker with no `purged_at`, so the purge finishes without replaying the event by hand.
