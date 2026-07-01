# @shipfox/api-workflows

## 0.1.0

### Minor Changes

- 5c18360: Durable gate restart: a failing gate's `on_failure.restart_from` now records the failed attempt, rewinds the job's step projection from the named earlier step back to pending (opening fresh attempts), and leaves the job running so it re-executes from there — all in one transaction with the report. A per-step attempt cap (default 3) bounds restart loops, exhausting to a `restart_exhausted` failure. Adds the `workflows.step.restart_enqueued` event.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- 736249b: Expose step attempts in the read API: the run-detail endpoint now returns `current_attempt` on each step plus its per-attempt history (`attempts[]`, with status, exit code, gate result and restart reason), so a restarted step's attempts are visible.
- 2bc5595: Adds workflow-run cancellation across the API, orchestration queue cleanup, event contract, and run-page cancel action.
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

- f98c2be: [api/workflows] Add the lease-authed `POST /runs/jobs/current/checkout-token` endpoint. The runner exchanges its job lease for short-lived, read-only repository checkout credentials. The job's checkout intent is resolved server-side from the authoritative `jobId` claim (`job -> run -> project` source metadata) and minted on demand via the integration service's `createCheckoutSpec()`; no credential material is ever stored on the job/run or queued. `checkoutTokenResponseSchema.auth` becomes optional so credential-free providers (debug) can return a public clone URL with no token, and `integrationRouteErrorHandler` is exported from `@shipfox/api-integration-core` so the route reuses the shared provider-error mapping.
- e9396c9: Give every runner-dispatched job a synthetic "Set up job" step at position 0 (à la GitHub Actions), so failures that happen around the user steps — workspace preparation today, the repository checkout next — are reported through the existing per-step protocol instead of hanging the job until the lease/timeout fires. The runner prepares the per-job workspace inside this step and reports the outcome; a failed setup flows through the existing fail-job cascade, finalizing the job `failed` in seconds with no user step run.

  Extends `stepErrorDtoSchema` with an optional machine-readable `reason` (`workspace_prep_failed`, `git_unavailable`, `checkout_*`, `setup_aborted`) and a `category` (`setup` | `user`). The runner reports `reason`; the server derives `category` from the step type on read (the runner is an untrusted boundary). The restart resolver now skips the synthetic step so a user step named "Set up job" can never rewind setup mid-job.

- 139e3be: Execute step gates at runtime: evaluate `gate.success_if` (CEL) against the step's exit code to decide pass/fail — overriding the raw command status — and record the gate result on the attempt. A failing gate fails the job; a missing exit code or an evaluation error fails closed as a plain command failure; a failing gate with `on_failure.restart_from` fails closed with a structured `restart_unsupported` error until durable restart lands.
- c652a68: Add a single reliable job-terminal event: `workflows.job.terminated` is now written in the same transaction as every terminal job-status flip (normal completion, DAG cancellation, lease-expiry resolution, and timeout), and the run-level `workflows.workflow_run.terminated` is emitted the same way. All workflows event names are aligned on one `WORKFLOWS_<entity>_<verb>` scheme, so the run and job terminal events read as the same event at two scopes.

  Internal breaking change (`WORKFLOWS_JOB_COMPLETED` → `WORKFLOWS_JOB_STEPS_SETTLED`, `WORKFLOW_RUN_*` → `WORKFLOWS_WORKFLOW_RUN_*`, with matching DTO type renames) consumed only within this monorepo.

- 121b42e: Track per-step execution attempts: add a `step_attempts` history table and a `steps.current_attempt` column, open a running attempt at dispatch and finalize it at report, and make step-result reporting attempt-aware (idempotent duplicate reports, rejected future attempts, no-op stale attempts).
- c0a883c: Adds the runner-facing per-step endpoints (`POST /runs/jobs/current/steps/next` and `/steps/:stepId/report`) authed by a locally-verified job lease token, with the matching request/response schemas.
- d69b164: Adds workflow run attempt lineage APIs and a run summary switcher for navigating rerun attempts.
- b74f635: Adds workflow run interpolation context resolution while preserving authored step configuration for reruns and diagnostics.
- e699508: Adds first-class skipped workflow jobs with persisted status reasons across API DTOs, orchestration, events, and client run views.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- 2c156d2: Extracts pure workflow runtime scheduling decisions behind the existing workflows orchestration host.
- 97162dd: Resolves agent provider, model, and thinking defaults at workflow run creation using workspace and instance configuration.
- b694b09: Add the per-step progression domain service (`nextStepForJob`, `recordStepResult`) and its guarded DB primitives over the existing `steps` table. Dormant until the per-step runner protocol is wired into the HTTP and orchestration layers; no runtime behavior changes yet.
- c47be09: Reshape Scheduling around runner job leases. Jobs are now enqueued with `workflowRunId`, `workflowRunAttemptId`, `jobId`, and `jobExecutionId`; the claim route mints a job lease token and returns the same workflow/job identity tuple. The stuck-job detector emits `runners.job.lease_expired` with that tuple when a lease expires.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- e250c4c: Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- a982f20: Stop a permanently-broken trigger subscription from starving its siblings or wedging the outbox. Integration dispatch now attempts every matched subscription and classifies each `runWorkflow` failure: a permanent error (deleted definition or project mismatch) is recorded and skipped, while a transient one re-throws so the outbox replays the event and converges. The event reaches a terminal outcome once no transient error remains (`routed` when any run was created, otherwise the new `errored` outcome), with a guarded write that never records `errored` over an event that already produced a run. The manual-fire path records the same terminal outcome, and `@shipfox/api-workflows` exports an `isPermanentRunWorkflowError` classifier. The trigger-events read API (`triggerEventOutcomeSchema`) accepts the new `errored` outcome for serialization and filtering.
- 998eba3: Adds phase-aware workflow context metadata, availability predicates, and creation-phase workflow context assembly for runtime materialization.
- 247cbd6: Adds label-aware runner job claiming with shared runner-label validation and required-label orchestration.
- 6077301: Adds shared timestamp/id keyset pagination helpers and migrates workflow run and trigger event lists onto them.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- f9153e8: Persists parsed workflow models on run attempts so later workflow phases can materialize from the frozen template.
- f9bf446: Extract the step-report decision into a pure `decideStepTransition` plus a durable `applyStepTransition`, creating the seam where gate evaluation and durable restart will plug in. No behavior change.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
- Updated dependencies [eb40964]
- Updated dependencies [0a6318f]
- Updated dependencies [5c18360]
- Updated dependencies [067a260]
- Updated dependencies [34ba284]
- Updated dependencies [8100b48]
- Updated dependencies [8f51daf]
- Updated dependencies [e689abf]
- Updated dependencies [59ba68b]
- Updated dependencies [7a9943d]
- Updated dependencies [b9c3f32]
- Updated dependencies [2325d76]
- Updated dependencies [d02c5fd]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [cdf8989]
- Updated dependencies [5cdfc69]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [a68ed61]
- Updated dependencies [2bc5595]
- Updated dependencies [1127ba2]
- Updated dependencies [de54da2]
- Updated dependencies [7b175f5]
- Updated dependencies [fd83878]
- Updated dependencies [97162dd]
- Updated dependencies [857879a]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [b0a0e1a]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [62c25a5]
- Updated dependencies [998eba3]
- Updated dependencies [3afb7e3]
- Updated dependencies [1daf39a]
- Updated dependencies [247cbd6]
- Updated dependencies [1d98b19]
- Updated dependencies [c652a68]
- Updated dependencies [fb64f13]
- Updated dependencies [75520ff]
- Updated dependencies [f47cff8]
- Updated dependencies [62720ea]
- Updated dependencies [c0a883c]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [9d3b43a]
- Updated dependencies [3bea87f]
- Updated dependencies [d69b164]
- Updated dependencies [69d02e5]
- Updated dependencies [2fb3e87]
- Updated dependencies [b74f635]
- Updated dependencies [ef1e917]
- Updated dependencies [61de795]
- Updated dependencies [88b9793]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [e699508]
- Updated dependencies [ad6056b]
- Updated dependencies [9c149d1]
- Updated dependencies [fb64f13]
- Updated dependencies [8ecc121]
  - @shipfox/api-definitions@0.1.0
  - @shipfox/api-workflows-dto@1.0.0
  - @shipfox/api-agent@0.1.0
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-runners@0.1.0
  - @shipfox/api-runners-dto@1.0.0
  - @shipfox/expression@1.1.0
  - @shipfox/api-auth@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core@0.1.0
  - @shipfox/api-projects@0.0.1
  - @shipfox/node-error-monitoring@0.1.1
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/node-drizzle@0.1.0
