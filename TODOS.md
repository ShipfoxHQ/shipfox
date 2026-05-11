# TODOs

## Projects

- [ ] **Production GitHub/GitLab provider setup design** — Design the production connection picker, repository search/list states, provider permissions, revoked/unavailable access handling, and `.shipfox` config status once real GitHub/GitLab providers and repository list/search APIs exist.

- [ ] **Projects Playwright E2E (incl. layout journey)** — Add browser coverage for Projects hub -> create -> detail once the client/API E2E harness exists. Layout-specific paths to cover (added 2026-05-06 by /plan-eng-review on `noe-charmet/rework-ui-layout`): workspace switch via combobox + URL update + lastWorkspaceIdAtom write; project switch from one project to another within a workspace; `/` redirect honors lastWorkspaceIdAtom (valid + stale + undefined cases); workspace-project consistency guard at `/workspaces/$wid/projects/$pid` redirects on cross-workspace pid; auth-gated routes (`/workspaces/$wid`, `/setup/*`) redirect unauthenticated visits to `/auth/login`; cmd+K opens workspace switcher.

- [ ] **Project switcher lazy-fetch + pagination** — The project switcher in the new top-nav (added on `noe-charmet/rework-ui-layout`) fetches `useProjectsInfiniteQuery(workspaceId)` eagerly on every `MainLayout` mount. Acceptable while workspaces have <~100 projects; degrades at scale. Couple the fix with the existing "cursor-based pagination" TODO under the workflows section: when the list endpoints adopt cursor pagination, switch the project switcher to (a) lazy-fetch on dropdown open, (b) fetch only the first page initially, (c) load more pages on scroll. Single coordinated change.

- [ ] **VRT snapshot for many-workspaces overflow** — Existing `workspaces/switcher-*` snapshots in `e2e/client/workspaces/tests/workspace-flows.e2e.ts` cover the open/empty-search/single-with-create states but not the overflow case (the seeded users have at most a handful of workspaces). Add an Argos snapshot of `WorkspaceSwitcher` with enough workspaces to overflow `max-h-300`, proving the footer stays pinned while the list scrolls. The bulk-seed helper at `@shipfox/e2e-helper-workspaces` (`workspaces.create({userId, name})`) already supports loop-creating N workspaces, so this is a ~15-line addition; deferred only because the empty-search and single-with-create snapshots already catch the most likely regressions.

## Integrations

- [ ] **GitHub lifecycle webhook handling** — Add GitHub App webhook verification and handlers for installation suspend/delete and repository access changes. The backend currently stores `latest_event`, `suspended_at`, and `deleted_at` on `integrations_github_installations`, but the first GitHub provider PR only updates those fields during callback. Webhook ingestion should keep connection lifecycle state accurate when GitHub changes app access after installation.

- [ ] **Webhook-driven definition resync** — Resync source-backed workflow definitions when GitHub push/repository-change webhooks indicate files under `.shipfox/workflows/` may have changed. PR #4 syncs definitions at project source binding time; continuous sync should be built after GitHub webhook verification and ingestion exist so repository edits do not silently diverge from Shipfox definitions.

- [ ] **Commit-pinned and alternate-branch definition sync** — Design immutable commit-SHA-pinned workflow definition snapshots for reproducible runs, plus an explicit user/test path to sync definitions from a non-default branch before merge. PR #4 intentionally syncs only the repository default branch using `ref`; this follow-up needs schema/index retention rules and workflow-run source-version semantics.

## Add cursor-based pagination to list endpoints

**What:** Add cursor-based pagination to `listWorkflowRunsByProject`, `listDefinitionsByProject`, and future list queries.

**Why:** All list endpoints currently return unbounded result sets. As runs accumulate, these queries will degrade. Pagination is a prerequisite for production use.

**Pros:** Prevents slow queries and OOM at scale. Standard API ergonomics.

**Cons:** Adds complexity to every list query and route. Needs a shared pagination helper to avoid DRY violations across modules.

**Context:** Both the definitions and workflows modules have list endpoints that return all rows matching a project. The right approach is cursor-based (keyset) pagination using `created_at` + `id` as the cursor, not offset-based. Consider building a shared `paginatedQuery` helper in `@shipfox/node-drizzle` or `@shipfox/node-fastify` to standardize the pattern across modules.

**Depends on:** Nothing. Can be done as a standalone PR.

## Add runner authentication

**What:** Add authentication to runner protocol endpoints (`POST /runners/jobs/request` and `POST /runners/jobs/:id/complete`).

**Why:** Runner protocol is a public API surface. Without auth, anyone can claim and complete jobs. Required before any non-local deployment.

**Pros:** Security baseline for runner protocol.

**Cons:** Requires runner registration flow, token management.

**Context:** The system design spec describes a `POST /api/runners/register` endpoint that issues `RunnerCredentials` via a registration token. Runner protocol endpoints should validate these credentials. For production, consider runner-scoped tokens with workspace and capability restrictions.

**Depends on:** Nothing. Can be built independently.

## Single-statement `applyStepResults` for many-step jobs

**What:** Collapse the N-update + 1-cancellation-sweep pattern in `applyStepResults` (`libs/api/workflows/src/db/workflow-runs.ts`) into a single `UPDATE steps SET status = CASE id WHEN ... END, error = CASE id WHEN ... END WHERE job_id = ?` for jobs with many reported steps.

**Why:** The current implementation does N+1 UPDATEs per transaction. Fine for typical jobs (<20 steps). At 100+ steps, the round-trip overhead becomes the dominant cost.

**Pros:** Single round-trip, atomic by construction.

**Cons:** SQL gets noisier; harder to read. Premature for current step counts.

**Context:** Tracked in the per-step-runtime-reporting plan. The terminal-state guard and canonical-set semantics must be preserved in the rewrite. Defer until typical jobs exceed ~20 steps.

**Depends on:** Nothing.

## Workspaces

- [ ] **Rate limiting on auth endpoints** — `POST /auth/login`, `POST /auth/password-reset`, `POST /auth/verify-email/resend` are abuse surfaces. Login is CPU-expensive (argon2id verify, ~50–200ms each) and unbounded credential-stuffing pegs a CPU. Verify-email/resend and password-reset can be used for free email bombardment of a known address. Build a shared per-IP-and-per-email rate-limit primitive (Redis token bucket or postgres counter) and wire it as Fastify hooks on the affected routes. Tracked here because it must precede any non-trivial public exposure.

- [ ] **Graceful JWT secret rotation** — Current model is "rotate = forced re-login": operator changes `WORKSPACE_JWT_SECRET`, restarts, all in-flight tokens fail verification. For zero-downtime rotation, support two simultaneous secrets in `createJwtAuthMethod` — sign with the new key, accept either for verify, retire the old after token TTL window. Schema: `WORKSPACE_JWT_SECRET` (active) + `WORKSPACE_JWT_SECRET_PREVIOUS` (verify-only). No DB schema change needed.

- [ ] **Client-side refresh single-flight** — The backend refresh-token model uses strict single-use rotation: once `/auth/refresh` succeeds, the old refresh cookie is invalid. Browser clients must coordinate refresh calls so multiple tabs/components do not send the same cookie concurrently and accidentally log the user out. Build a shared client auth primitive that keeps one in-flight refresh request per browser session and lets all callers await that same promise. This is intentionally deferred because this repo currently has no frontend client surface.

- [ ] **Project-scope authorization model** — Existing routes under `/api/projects/:projectId/...` (definitions, workflows, runners) are project-scoped, not workspace-scoped. `libs/api/workflows/src/presentation/routes/create-run.ts:31` falls back to using `projectId` as `workspaceId`, which is incorrect. Decide whether projects belong to a workspace (1:N) or whether projects have their own membership model, then make those routes JWT-authable for human users. Out of scope for the auth plan; this needs its own design pass.

- [ ] **OR-semantics for `createAuthHook`** — Today `createAuthHook(['api-key', 'jwt'])` runs both methods sequentially as AND. To let a single route accept either kind of caller (CLI with api-key, browser with JWT) we need a `tryEither` mode that succeeds on the first auth that passes. Lives in `libs/shared/node/fastify/src/auth.ts`. Defer until there's a real consumer (project-scope auth above is the likely first one).

- [ ] **Closed-source: roles on memberships** — OSS distribution of workspaces has no roles (every member has full access). Closed-source adds `role enum('owner','admin','member')` to `workspaces_memberships` via additive migration, plus role-gated routes (only owners can transfer ownership, only admins+owners can remove members, etc.). Schema and route changes are additive, no OSS breakage.

- [ ] **Full cross-site browser auth cookies** — The first client auth foundation supports cross-origin, same-site browser auth with `SameSite=Lax` refresh cookies. If the frontend and API ever live on unrelated sites, add explicit cookie policy config for `SameSite=None; Secure`, verify browser behavior in Playwright, and document the deployment constraints. This is intentionally deferred until that hosting shape is required.

## Visual testing

- [ ] **Smoke gate for Argos uploads** — assert N>0 screenshots arrived per CI run so a missing `ARGOS_TOKEN` or a misconfigured `@argos-ci/playwright` reporter surfaces in GitHub Actions instead of going silent. The Storybook upload step already exits non-zero on token failure; the Playwright reporter currently warns and exits 0. Implementation sketch: post-step that queries the Argos build via API, or counts files written by the reporter before upload. Effort: ~30 min. Accepted as v1 risk in the visual-testing baseline plan.

## Outbox / Dispatcher

- [ ] **Outbox row retention** — Add periodic cleanup of dispatched outbox rows older than 7 days. Dispatched rows accumulate in each module's `{module}_outbox` table. At scale this bloats the table. Simple fix: periodic `DELETE FROM {module}_outbox WHERE dispatched_at < now() - interval '7 days'` in the dispatcher workflow or a separate Temporal cron. Consider archiving to a separate table first if audit trail is needed. Blocked on: outbox + dispatcher implementation.

## Runner liveness follow-ups

- [ ] **Per-job-type configurable timeout** — `jobOrchestration` currently hardcodes `JOB_MAX_DURATION = '60 minutes'`. Add a `timeout` field on the step/job spec parsed by Definitions, persisted on the `jobs` row, and read by `jobOrchestration` via input. Default to 60min when unset. Necessary for mixed quick/long-running jobs (notify steps don't need 60min; nightly ETL steps need more). Schema-additive on `jobs`.

- [ ] **Bulk DELETE…RETURNING + bulk outbox in `detectAndFailStuckJobs`** — Today the function is N+1: SELECT stuck rows, then per-row `finalizeRunningJob` (atomic `DELETE … WHERE last_heartbeat_at < cutoff RETURNING run_id` + 1-row outbox insert). Total ~1 SELECT + N DELETEs per cron tick. Acceptable at handful-of-runners scale; revisit with a single transaction `DELETE FROM running_jobs WHERE last_heartbeat_at < $threshold RETURNING job_id, run_id` plus a multi-row outbox insert when concurrent-job counts demand it. Likely depends on a `writeOutboxEvents` (plural) helper in `@shipfox/node-outbox`.

- [ ] **`cancelRun(runId)` + DAG-wide cancellation propagation** — The heartbeat-cancel plumbing is wired (cancellation_requested_at column + heartbeat response field) but only consumed by `jobOrchestration`'s timeout. Add a `cancelRun` command in Workflows that walks the DAG, calls `requestJobCancellation` for each running job in the run, and signals `WorkflowRunOrchestration`/child `JobOrchestration`s to abort. Spec context: `.claude/research/system-design.md:341`. Closes the user-facing "stop this run" UX gap without protocol change on the runner side.

- [ ] **Calibrate stuck-job threshold + failure observability** — The detector uses a 180s threshold (≈18× the 10s heartbeat interval). Under a 3-minute Postgres or network blip, healthy long-running jobs whose heartbeats are silently failing will be killed. Two follow-ups: (1) emit a Prometheus/OpenTelemetry counter for "jobs failed by detector" so we can detect calibration mismatches in production; (2) consider raising the default to 300s (or making it configurable per-tenant) once we have load data. Couple this with a runner-side warning log when consecutive heartbeat failures exceed `intervalMs * N` so disconnects are visible before the detector fires.

- [ ] **Worker-boot failures should fail the app, not log a warning** — `startModuleWorkers` at `libs/shared/node/module/src/initialize.ts:103-138` catches per-worker creation/start errors and only logs a warning. `apps/api/src/core/run.ts:54` calls it without `await`. A typo in `workflowsPath`, a missing dist file, or a Temporal connection issue at startup means a registered worker silently fails to start — and we lose the safety net (e.g. the `runners-maintenance` cron that fails stuck jobs). Two-line fix: re-throw in `startModuleWorkers`, `await` in `run.ts`. Defer because it touches an app-boot critical path that should be tested carefully (which other modules depend on this catch-and-warn behavior?). Surfaced by codex on the workflows↔runners decoupling PR.
