# @shipfox/api-runners

## 0.1.0

### Minor Changes

- 8100b48: Adds the provisioned-runner reconcile endpoint and shared request/response schemas for provisioner state recovery.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- 2bc5595: Adds workflow-run cancellation across the API, orchestration queue cleanup, event contract, and run-page cancel action.
- c47be09: Reshape Scheduling around runner job leases. Jobs are now enqueued with `workflowRunId`, `workflowRunAttemptId`, `jobId`, and `jobExecutionId`; the claim route mints a job lease token and returns the same workflow/job identity tuple. The stuck-job detector emits `runners.job.lease_expired` with that tuple when a lease expires.
- f9f059e: Cut the runner protocol over to per-step pull/report and remove the job-atomic path.

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

- fb64f13: Adds a job lease capability token (HS256, `verifyJobLeaseToken` plus the claims schema) so runner step calls can be authenticated in-process without a hop back to Scheduling.
- 6181819: Adds runner registration sessions with bounded label contracts, session-token auth, and lease-token heartbeat ownership.

### Patch Changes

- 2325d76: Adds provisioned-runner terminate intent signals for cancelled bound jobs across runner polling and reconcile responses.
- c0a883c: Moves the job lease capability token codec and its claims schema from the runners packages into api-auth/api-auth-dto, renaming its config to `AUTH_JOB_LEASE_TOKEN_*`, so all signed-token codecs live with authentication. Adds a shared leased-job auth context for request-scoped lease claims, and a shared `createLeaseTokenAuthMethod` (the `leased-job` auth method) registered on the auth module so any feature module can protect routes with a lease token by name.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 5729548: Stuck-job expiry now reaps a bounded batch in one transaction instead of N+1: a single `DELETE … RETURNING` (oldest-first, `FOR UPDATE SKIP LOCKED`, capped at 100 per tick) feeds a multi-row outbox insert via the new `writeOutboxEvents` helper. Behavior is unchanged (same rows reaped, one `runners.job.lease_expired` event per reaped job, same orphan-pending sweep).
- e250c4c: Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
- 247cbd6: Adds label-aware runner job claiming with shared runner-label validation and required-label orchestration.
- 1d98b19: Rewrites the pending-job claim query with the Drizzle query builder instead of raw SQL, keeping the same FOR UPDATE SKIP LOCKED locking behavior.
- 75520ff: Add the foundation for metrics observability. `@shipfox/node-module` gains an optional `metrics` hook on `ShipfoxModule` plus `registerModuleMetrics`, a declarative slot for modules to register service-level metrics (observable gauges) once at app startup, kept separate from `initializeModules` so unit tests never bind the metrics port. `@shipfox/api-runners` is instrumented as the worked example across both planes: instance counters for job enqueue, claim, and lease expiry recorded inline, and `runners_pending_jobs` / `runners_running_jobs` observable gauges over a new `getJobQueueDepth` query wired through the module hook.
- 62720ea: Consolidates runner label canonicalization on `@shipfox/runner-labels` across runner scheduling and protocol code.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
- Updated dependencies [eb40964]
- Updated dependencies [5c18360]
- Updated dependencies [34ba284]
- Updated dependencies [8100b48]
- Updated dependencies [7a9943d]
- Updated dependencies [b9c3f32]
- Updated dependencies [2325d76]
- Updated dependencies [d02c5fd]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [7b175f5]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [b525dcd]
- Updated dependencies [b0a0e1a]
- Updated dependencies [857fd73]
- Updated dependencies [3afb7e3]
- Updated dependencies [1daf39a]
- Updated dependencies [247cbd6]
- Updated dependencies [c652a68]
- Updated dependencies [fb64f13]
- Updated dependencies [75520ff]
- Updated dependencies [62720ea]
- Updated dependencies [c0a883c]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [d69b164]
- Updated dependencies [2fb3e87]
- Updated dependencies [ef1e917]
- Updated dependencies [61de795]
- Updated dependencies [88b9793]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [e699508]
- Updated dependencies [9c149d1]
- Updated dependencies [fb64f13]
- Updated dependencies [8ecc121]
  - @shipfox/api-workflows-dto@1.0.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-runners-dto@1.0.0
  - @shipfox/api-auth@0.1.0
  - @shipfox/api-workspaces@0.1.0
  - @shipfox/node-tokens@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/runner-labels@0.0.1
  - @shipfox/config@1.2.0
