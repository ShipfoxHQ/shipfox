---
"@shipfox/api-runners-dto": minor
"@shipfox/api-runners": minor
"@shipfox/api-workflows": minor
---

Cut the runner protocol over to per-step pull/report and remove the job-atomic path.

The job workflow now terminates on two signals: `job-finished` (raised by
`recordStepResult` on step exhaustion) and `job-lease-expired` (raised by the new
`runners.job.lease_expired` subscriber). A precedence ladder keeps a genuinely
finished job from being failed by a late lease expiry, and the lease-expiry branch
re-derives the outcome from the authoritative step projection in a single
transaction (server state is the final gate). On finish the workflow releases the
lease via `releaseJob` (deleting both the running and any orphaned pending row);
release is best-effort so a Scheduling outage never blocks the run DAG.

Removed the atomic path end to end: the runner `POST /runners/jobs/:jobId/complete`
route, the `RUNNER_JOB_COMPLETED` event, `finalizeRunningJob`/`completeJob`, the
`applyStepResults*` apply path and its workflow subscriber, and the dead
`jobPayload*`/`complete-job` DTO schemas. The runner now parses the step-less claim
response, and `claimPendingJob` drops an orphan pending row instead of poison-looping.

Internal breaking change (deleted exported DTOs/events and a runner route, plus a
Temporal signal rename) consumed only within this monorepo; backend and agent ship
together.
