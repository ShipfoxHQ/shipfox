# @shipfox/api-runners-dto

## 0.1.0

### Minor Changes

- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- c47be09: Reshape Scheduling around runner job leases. Jobs are now enqueued via `scheduleJob({jobId, workspaceId, runId})`, and the claim route mints a job lease token and returns `{job_id, run_id, lease_token}`. The stuck-job detector now emits a new `runners.job.lease_expired` event (`RUNNER_JOB_LEASE_EXPIRED`, payload `{jobId, runId}`) when a lease expires.
- fb64f13: Adds a job lease capability token (HS256, `verifyJobLeaseToken` plus the claims schema) so runner step calls can be authenticated in-process without a hop back to Scheduling.

### Patch Changes

- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
