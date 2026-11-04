---
"@shipfox/api-agent": patch
---

Finishes the purge of a deleted project's conversations and sessions when its `PROJECT_DELETED` event was dead-lettered. The Agent module runs the purge again every minute for deletion markers with no `purged_at`, so a turn that stops late no longer strands the project's rows.
