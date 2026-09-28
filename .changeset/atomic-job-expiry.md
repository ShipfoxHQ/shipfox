---
"@shipfox/api-runners": minor
"@shipfox/api-runners-dto": minor
---

Expires pending job executions atomically relative to claims, so an execution is never expired after a runner has claimed it; late or repeated enqueues of an already-handled execution are ignored.
