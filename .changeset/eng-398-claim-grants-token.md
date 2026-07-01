---
"@shipfox/api-runners-dto": minor
"@shipfox/api-runners": minor
"@shipfox/api-workflows": patch
---

Reshape Scheduling around runner job leases. Jobs are now enqueued with `workflowRunId`, `workflowRunAttemptId`, `jobId`, and `jobExecutionId`; the claim route mints a job lease token and returns the same workflow/job identity tuple. The stuck-job detector emits `runners.job.lease_expired` with that tuple when a lease expires.
