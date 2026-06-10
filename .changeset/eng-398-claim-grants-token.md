---
"@shipfox/api-runners-dto": minor
"@shipfox/api-runners": minor
"@shipfox/api-workflows": patch
---

Reshape Scheduling around runner job leases. Jobs are now enqueued via `scheduleJob({jobId, workspaceId, runId})`, and the claim route mints a job lease token and returns `{job_id, run_id, lease_token}`. The stuck-job detector now emits a new `runners.job.lease_expired` event (`RUNNER_JOB_LEASE_EXPIRED`, payload `{jobId, runId}`) when a lease expires.
