# @shipfox/api-runners

## 0.1.0

### Minor Changes

- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- c47be09: Reshape Scheduling around runner job leases. Jobs are now enqueued via `scheduleJob({jobId, workspaceId, runId})`, and the claim route mints a job lease token and returns `{job_id, run_id, lease_token}`. The stuck-job detector now emits a new `runners.job.lease_expired` event (`RUNNER_JOB_LEASE_EXPIRED`, payload `{jobId, runId}`) when a lease expires.
- fb64f13: Adds a job lease capability token (HS256, `verifyJobLeaseToken` plus the claims schema) so runner step calls can be authenticated in-process without a hop back to Scheduling.

### Patch Changes

- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- 1d98b19: Rewrites the pending-job claim query with the Drizzle query builder instead of raw SQL, keeping the same FOR UPDATE SKIP LOCKED locking behavior.
- Updated dependencies [5c18360]
- Updated dependencies [7a9943d]
- Updated dependencies [c0a883c]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [c47be09]
- Updated dependencies [940696a]
- Updated dependencies [1daf39a]
- Updated dependencies [fb64f13]
- Updated dependencies [c0a883c]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [fb64f13]
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/api-runners-dto@0.1.0
  - @shipfox/api-auth@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/api-workspaces@0.0.1
  - @shipfox/node-drizzle@0.0.1
  - @shipfox/node-outbox@0.0.1
