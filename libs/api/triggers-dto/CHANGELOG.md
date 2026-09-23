# @shipfox/api-triggers-dto

## 32.1.0

### Patch Changes

- @shipfox/api-workflows-dto@32.1.0

## 32.0.0

### Patch Changes

- Updated dependencies [212c6b6]
  - @shipfox/api-workflows-dto@32.0.0

## 31.0.0

### Minor Changes

- 9b671f9: Manual trigger firing accepts optional `secretInputs`, pins each secret to its resolved project scope, and fails with `secret-not-found` naming the missing key.
- bcd9232: Adds a specific trigger diagnostic for missing configured secrets.
- 85f3d47: Adds shape-only event-trigger checks and reports whether a replay event was checked.

### Patch Changes

- Updated dependencies [bab2786]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
  - @shipfox/api-workflows-dto@31.0.0
  - @shipfox/api-secrets-dto@31.0.0
  - @shipfox/api-definitions-dto@31.0.0

## 30.0.0

### Patch Changes

- Updated dependencies [b734fcf]
  - @shipfox/api-workflows-dto@30.0.0
  - @shipfox/api-definitions-dto@30.0.0

## 29.1.0

### Patch Changes

- @shipfox/api-workflows-dto@29.1.0

## 29.0.0

### Patch Changes

- Updated dependencies [e7a8fe4]
  - @shipfox/api-workflows-dto@29.0.0
  - @shipfox/api-definitions-dto@29.0.0

## 28.0.0

### Minor Changes

- 16b21f3: Accepts local workflow `content` with an optional `ref`, and returns the resolved `ref` and validation `warnings`.
  Adds `availableTriggerKeys` and replay-event mismatch fields to refusal details.
- 6338cc4: Adds the `checkDevRun` inter-module command for validating dev-run definitions and trigger filters without starting a run or journaling an event.
- c2f1aab: Allows workflow runs to fire manual triggers with parent-run causation and workflow trigger history.

### Patch Changes

- Updated dependencies [e8f0212]
- Updated dependencies [d62e17e]
- Updated dependencies [7067bc3]
  - @shipfox/api-workflows-dto@28.0.0

## 27.2.0

### Patch Changes

- Updated dependencies [ef44a76]
- Updated dependencies [6ad8c2e]
- Updated dependencies [45cf692]
- Updated dependencies [f5bc959]
  - @shipfox/api-definitions-dto@27.2.0
  - @shipfox/api-workflows-dto@27.2.0

## 27.1.0

### Patch Changes

- Updated dependencies [e0b7bd1]
  - @shipfox/api-workflows-dto@27.1.0

## 27.0.0

### Patch Changes

- @shipfox/api-workflows-dto@27.0.0

## 26.1.0

### Patch Changes

- Updated dependencies [db12613]
- Updated dependencies [cb99d51]
  - @shipfox/api-definitions-dto@26.1.0
  - @shipfox/api-workflows-dto@26.1.0

## 26.0.0

### Minor Changes

- e157b10: Expose `fireManualTrigger` and `createDevRun` as inter-module trigger commands. `fireManualTrigger` accepts an optional idempotency key and reports deduplicated runs.
- 5cb4279: Joins initial workflow runs to resolved concurrency groups with transactional claim admission, claim outbox events, and accurate concurrency-group interpolation errors.

### Patch Changes

- Updated dependencies [da717b1]
- Updated dependencies [5cb4279]
- Updated dependencies [aafce80]
  - @shipfox/api-workflows-dto@26.0.0

## 22.0.0

### Minor Changes

- c392dfb: Adds typed synthetic listener dispatch and shared payload limits for production-shaped E2E coverage.

## 21.2.0

### Minor Changes

- 41e1cfc: Surfaces precise, safe trigger event errors in the event detail callout.

### Patch Changes

- 8407bd1: Rejects oversized listener fire deliveries without suppressing matching resolve events.

## 21.0.0

### Minor Changes

- f3df1e5: Add bounded Agent Access trigger-event detail and facet discovery tools.

## 19.0.0

### Minor Changes

- 5af8d52: Adds project catalog and workflow-definition reads, plus trigger-event summaries, details, and facets.

### Patch Changes

- @shipfox/inter-module@0.2.3

## 15.0.0

### Minor Changes

- 1801f46: Adds `POST /dev-runs` for manually and cron-triggered dev runs. Manual runs build inputs from the request body (overriding the trigger's `with`); cron runs take inputs from the trigger's `with` and reject body inputs. Pins the optional commit, answering 409 `ref-moved` on mismatch and 422 `replay-event-required` for integration-source triggers. Ships the request body schema and `201 {workflow_run_id, commit}` response DTOs in `@shipfox/api-triggers-dto`.
- c6e7526: Adds targeted replay to `POST /dev-runs` for integration-source triggers.
  Requests may provide `replay_event_id` to use the recorded payload and integration connection.
  Manual and scheduled triggers reject `replay_event_id`.
  Refusals return `trigger-filtered` (409), `replay-event-mismatch` (409), `replay-event-not-found` (404), or `replay-event-unavailable` (410).
  Development journal entries retain `replay_of_event_id` for each replay attempt.

## 14.0.0

### Minor Changes

- 05c7c4d: Adds dev-run and replay-link support to trigger journal interfaces and client types.
- b6c7871: Adds `origin` and `replayable` filters to the trigger events list, an `origins` facet, and `replay_of_event_id` with a `replays` list on the event detail response.

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- a460020: Add trigger event detail decisions with stored subscription names, run links, and payload inspection.
- 5ec8367: Adds trigger event inspection endpoints with matching DTO schemas for listing received events and reading event decisions.

### Patch Changes

- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- a982f20: Stop a permanently-broken trigger subscription from starving its siblings or wedging the outbox. Integration dispatch now attempts every matched subscription and classifies each `runWorkflow` failure: a permanent error (deleted definition or project mismatch) is recorded and skipped, while a transient one re-throws so the outbox replays the event and converges. The event reaches a terminal outcome once no transient error remains (`routed` when any run was created, otherwise the new `errored` outcome), with a guarded write that never records `errored` over an event that already produced a run. The manual-fire path records the same terminal outcome, and `@shipfox/api-workflows` exports an `isPermanentRunWorkflowError` classifier. The trigger-events read API (`triggerEventOutcomeSchema`) accepts the new `errored` outcome for serialization and filtering.
- e192d86: Adds the cron firing engine: a once-per-minute tick fans out bounded drain activities that claim due schedules (FOR UPDATE SKIP LOCKED), advance their next fire time, and fire the workflow deduplicated and crash-safe, recorded in trigger history with a `cron` origin and surfaced through cron fire and backlog metrics.
