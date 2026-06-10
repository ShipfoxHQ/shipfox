---
"@shipfox/api-runners": patch
---

Rewrites the pending-job claim query with the Drizzle query builder instead of raw SQL, keeping the same FOR UPDATE SKIP LOCKED locking behavior.
