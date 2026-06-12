# @shipfox/api-workflows

## 0.1.0

### Minor Changes

- 5c18360: Durable gate restart: a failing gate's `on_failure.restart_from` now records the failed attempt, rewinds the job's step projection from the named earlier step back to pending (opening fresh attempts), and leaves the job running so it re-executes from there — all in one transaction with the report. A per-step attempt cap (default 3) bounds restart loops, exhausting to a `restart_exhausted` failure. Adds the `workflows.step.restart_enqueued` event.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- 736249b: Expose step attempts in the read API: the run-detail endpoint now returns `current_attempt` on each step plus its per-attempt history (`attempts[]`, with status, exit code, gate result and restart reason), so a restarted step's attempts are visible.
- 139e3be: Execute step gates at runtime: evaluate `gate.success_if` (CEL) against the step's exit code to decide pass/fail — overriding the raw command status — and record the gate result on the attempt. A failing gate fails the job; a missing exit code or an evaluation error fails closed as a plain command failure; a failing gate with `on_failure.restart_from` fails closed with a structured `restart_unsupported` error until durable restart lands.
- 121b42e: Track per-step execution attempts: add a `step_attempts` history table and a `steps.current_attempt` column, open a running attempt at dispatch and finalize it at report, and make step-result reporting attempt-aware (idempotent duplicate reports, rejected future attempts, no-op stale attempts).
- c0a883c: Adds the runner-facing per-step endpoints (`POST /runs/jobs/current/steps/next` and `/steps/:stepId/report`) authed by a locally-verified job lease token, with the matching request/response schemas.

### Patch Changes

- 2c156d2: Extracts pure workflow runtime scheduling decisions behind the existing workflows orchestration host.
- b694b09: Add the per-step progression domain service (`nextStepForJob`, `recordStepResult`) and its guarded DB primitives over the existing `steps` table. Dormant until the per-step runner protocol is wired into the HTTP and orchestration layers; no runtime behavior changes yet.
- c47be09: Reshape Scheduling around runner job leases. Jobs are now enqueued via `scheduleJob({jobId, workspaceId, runId})`, and the claim route mints a job lease token and returns `{job_id, run_id, lease_token}`. The stuck-job detector now emits a new `runners.job.lease_expired` event (`RUNNER_JOB_LEASE_EXPIRED`, payload `{jobId, runId}`) when a lease expires.
- f9bf446: Extract the step-report decision into a pure `decideStepTransition` plus a durable `applyStepTransition`, creating the seam where gate evaluation and durable restart will plug in. No behavior change.
- Updated dependencies [5c18360]
- Updated dependencies [59ba68b]
- Updated dependencies [7a9943d]
- Updated dependencies [c0a883c]
- Updated dependencies [cdf8989]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [857879a]
- Updated dependencies [c47be09]
- Updated dependencies [940696a]
- Updated dependencies [1daf39a]
- Updated dependencies [1d98b19]
- Updated dependencies [fb64f13]
- Updated dependencies [f47cff8]
- Updated dependencies [c0a883c]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [fb64f13]
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/api-definitions@0.0.1
  - @shipfox/api-runners@0.1.0
  - @shipfox/api-runners-dto@0.1.0
  - @shipfox/api-auth@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/expression@1.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/api-projects@0.0.1
  - @shipfox/node-drizzle@0.0.1
  - @shipfox/node-outbox@0.0.1
